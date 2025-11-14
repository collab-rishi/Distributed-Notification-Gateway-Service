import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import CircuitBreaker from 'opossum';
import { AxiosError } from 'axios'; 

// Define the shape for the preferences object returned by our UserService (used by the Controller)
export interface UserPreferenceApiDto {
    email: boolean;
    push: boolean;
}

// Define the shape of the PREFERENCE OBJECT returned by the external User Service
interface ExternalUserPreferenceDto {
    email: boolean;
    push: boolean;
    updated_at: string; 
}

// Define the shape of the actual user data object (within the 'data' envelope)
interface ExternalUserApiData {
    id: string;
    email: string;
    name: string;
    push_token?: string;
    created_at: string;
    updated_at: string;
    // CRITICAL FIX: preference is now an OBJECT
    preference: ExternalUserPreferenceDto; 
}

// Define the top-level wrapper returned by the external API
interface ExternalApiWrapper {
    success: boolean;
    data: ExternalUserApiData; // The actual user object is nested here
    error: any;
    message: string;
    meta: any;
}

// Define the shape of the data returned by this UserService to the Gateway Controller (After parsing)
export interface UserApiData {
    id: string;
    email: string;
    name: string;
    push_token?: string;
    preferences: UserPreferenceApiDto; // The object that is stripped of updated_at
}


// Define the shape for the circuit breaker options
interface CircuitBreakerOptions {
    timeout: number;
    errorThresholdPercentage: number;
    resetTimeout: number;
    name: string;
    fallback?: (error: any, userId: string) => any;
    errorFilter?: (error: any) => boolean; 
}

// Define a unique signal for the fallback status
export const DEFERRED_FALLBACK_SIGNAL = 'DEFERRED_BY_CIRCUIT_BREAKER';

@Injectable()
export class UserService {
    private readonly userBaseUrl: string;
    private readonly circuitBreaker: CircuitBreaker;
    private readonly logger = new Logger(UserService.name);

    constructor(
        private readonly httpService: HttpService,
        private readonly configService: ConfigService,
    ) {
        // --- Configuration Setup ---
        const userBaseUrl = this.configService.get<string>('USER_SERVICE_URL');
        if (!userBaseUrl) {
            throw new Error('FATAL: USER_SERVICE_URL environment variable is not configured.');
        }
        this.userBaseUrl = userBaseUrl;
        
        // --- Circuit Breaker Fallback Logic ---
        const fallbackFunction = (error: any, userId: string) => {
            this.logger.warn(`CIRCUIT FALLBACK: User Service dependency failed for user ${userId}. Status set to DEFERRED.`, error.message);
            return DEFERRED_FALLBACK_SIGNAL;
        };

        // --- Circuit Breaker Configuration ---
        const options: CircuitBreakerOptions = {
            timeout: 15000, 
            errorThresholdPercentage: 50, 
            resetTimeout: 10000, 
            name: 'user-service-lookup',
            fallback: fallbackFunction, 
            
            // Only count 5xx status codes or lack of response as errors that should trip the breaker
            errorFilter: (error: AxiosError) => {
                // If 4xx (e.g., 404), it's a business error, NOT a system failure. Do not trip breaker.
                if (error.response?.status && error.response.status < 500) {
                    return false;
                }
                // Count network errors, timeouts, and 5xx errors as failures
                return true;
            },
        };

        // Create the circuit breaker instance, wrapping the core lookup logic
        this.circuitBreaker = new CircuitBreaker(this.fetchUserData.bind(this), options);

        // --- Circuit Breaker Listeners (For Logging) ---
        this.circuitBreaker.on('open', () => 
            this.logger.error(`CIRCUIT BREAKER OPEN: ${this.circuitBreaker.name}. User Service is considered unhealthy.`)
        );
        this.circuitBreaker.on('halfOpen', () => 
            this.logger.warn(`CIRCUIT BREAKER HALF OPEN: ${this.circuitBreaker.name}. Attempting check request.`)
        );
        this.circuitBreaker.on('close', () => 
            this.logger.log(`CIRCUIT BREAKER CLOSED: ${this.circuitBreaker.name}. User Service is healthy again.`)
        );
    }
    
    /**
     * Core function that performs the actual HTTP call and data transformation. 
     */
    private async fetchUserData(userId: string): Promise<UserApiData> {
        const userEndpoint = `${this.userBaseUrl}/api/v1/users/${userId}`;
        
        try {
            // CRITICAL FIX: Explicitly specify the expected wrapper type
            const response = await firstValueFrom(this.httpService.get<ExternalApiWrapper>(userEndpoint));
            
            // CRITICAL FIX: Unpack the user data from the 'data' envelope
            const rawUserData: ExternalUserApiData = response.data.data;
            
            // The preference is already an object, so we access it directly.
            const preferencesObject: ExternalUserPreferenceDto = rawUserData.preference;

            // Return the transformed object structure expected by the Gateway Controller
            // We strip 'updated_at' to maintain the controller's expected interface.
            return {
                id: rawUserData.id,
                email: rawUserData.email,
                name: rawUserData.name,
                push_token: rawUserData.push_token,
                preferences: {
                    email: preferencesObject.email,
                    push: preferencesObject.push,
                },
            };

        } catch (error: any) {
            const status = error.response?.status;
            
            if (status === HttpStatus.NOT_FOUND) {
                // 404 is a valid business response, re-throw as an exception
                throw new HttpException(`User ID ${userId} not found.`, HttpStatus.NOT_FOUND);
            }
            
            // For connection failures, timeouts, or 5xx errors:
            // Throw the original error object (AxiosError) to trip the circuit.
            this.logger.error(`User Service call failed: Status ${status || 'Connection Error'}`, error.stack);
            throw error; 
        }
    }


    /**
     * Public method called by AppController. Executes the circuit breaker command.
     * @param userId The ID of the user to look up.
     * @returns The user data object OR the DEFERRED_FALLBACK_SIGNAL string.
     */
    async getUserData(userId: string): Promise<UserApiData | typeof DEFERRED_FALLBACK_SIGNAL> {
        try {
            // The promise resolves either to user data OR the DEFERRED_FALLBACK_SIGNAL
            const result = await this.circuitBreaker.fire(userId);
            
            // The result can be the UserApiData object or the DEFERRED_FALLBACK_SIGNAL string
            return result as UserApiData | typeof DEFERRED_FALLBACK_SIGNAL; 

        } catch (error) {
            
            // 1. Re-throw the 404 HttpException (Business Error)
            if (error instanceof HttpException) {
                throw error;
            }

            // 2. Catch the Circuit Breaker/Timeout error (System Failure)
            // When the circuit is CLOSED but the command fails (e.g., ETIMEDOUT), 
            // opossum throws the error. We must manually return the fallback signal.
            if (error && (error['code'] === 'ETIMEDOUT' || error['name'] === 'CircuitBreakerTimeoutError' || error['message'].includes('Timed out'))) {
                 this.logger.warn('Circuit Breaker rejected/timed out command, returning deferred signal.');
                 return DEFERRED_FALLBACK_SIGNAL;
            }

            // 3. Fallback for truly unhandled errors (should ideally not happen)
            this.logger.error('Truly unhandled error during circuit breaker execution:', error);
            throw new HttpException(
                'An unhandled dependency error occurred.',
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }
}