import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import CircuitBreaker from 'opossum';
import { AxiosError } from 'axios'; 


interface CircuitBreakerOptions {
    timeout: number;
    errorThresholdPercentage: number;
    resetTimeout: number;
    name: string;

    fallback?: (error: any, userId: string) => any;

    errorFilter?: (error: any) => boolean; 
}


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
       
        const userBaseUrl = this.configService.get<string>('USER_SERVICE_URL');
        if (!userBaseUrl) {
            throw new Error('FATAL: USER_SERVICE_URL environment variable is not configured.');
        }
        this.userBaseUrl = userBaseUrl;
        
        
        const fallbackFunction = (error: any, userId: string) => {
            this.logger.warn(`CIRCUIT FALLBACK: User Service dependency failed for user ${userId}. Status set to DEFERRED.`, error.message);
            return DEFERRED_FALLBACK_SIGNAL;
        };

        
        const options: CircuitBreakerOptions = {
            timeout: 1500, 
            errorThresholdPercentage: 50, 
            resetTimeout: 10000, 
            name: 'user-service-lookup',
            fallback: fallbackFunction, 
           
            errorFilter: (error: AxiosError) => {
                
                if (error.response?.status && error.response.status < 500) {
                    return false;
                }
               
                return true;
            },
        };

       
        this.circuitBreaker = new CircuitBreaker(this.fetchUserData.bind(this), options);

        
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
     * Core function that performs the actual HTTP call. 
     * It throws only if the error should open the circuit (5xx or connection error).
     */
    private async fetchUserData(userId: string): Promise<any> {
        const userEndpoint = `${this.userBaseUrl}/api/v1/users/${userId}`;
        
        try {
            const response = await firstValueFrom(this.httpService.get(userEndpoint));
            return response.data.data; 

        } catch (error: any) {
            const status = error.response?.status;
            
            if (status === HttpStatus.NOT_FOUND) {
                
                throw new HttpException(`User ID ${userId} not found.`, HttpStatus.NOT_FOUND);
            }
            
            
            this.logger.error(`User Service call failed: Status ${status || 'Connection Error'}`, error.stack);
            throw error; 
        }
    }


    /**
     * Public method called by AppController. Executes the circuit breaker command.
     * @param userId The ID of the user to look up.
     * @returns The user data object OR the DEFERRED_FALLBACK_SIGNAL string.
     */
    async getUserData(userId: string): Promise<any> {
        try {
           
            const result = await this.circuitBreaker.fire(userId);
            return result;

        } catch (error) {
            
            if (error instanceof HttpException) {
                throw error;
            }

            
            this.logger.error('Unhandled error during circuit breaker execution:', error);
            throw new HttpException(
                'An unhandled dependency error occurred.',
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }
}