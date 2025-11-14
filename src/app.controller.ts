import { 
    Controller,
    Param, 
    Post,
    Get,
    Body, 
    Inject, 
    HttpStatus, 
    HttpCode, 
    ValidationPipe, 
    UsePipes,
    UseGuards,
    HttpException,
    Logger
} from '@nestjs/common';
import { ClientProxy } from "@nestjs/microservices";

import { EMAIL_SERVICE_RABBITMQ, PUSH_SERVICE_RABBITMQ } from './constants'; 
import { SendNotificationDto, ReportStatusDto, NotificationType, PaginationMeta } from './app.dto'; 
import { ApiKeyAuthGuard } from './auth.guard';
import { PrismaService } from './database/prisma.service';

import { UserApiData, UserService, DEFERRED_FALLBACK_SIGNAL } from './user-service/user-service.service'; 


// Helper function to generate the standard meta object
const defaultMeta: PaginationMeta = {
    total: 1, 
    limit: 1, 
    page: 1, 
    total_pages: 1, 
    has_next: false, 
    has_previous: false 
};


@Controller() 
@UsePipes(new ValidationPipe({ transform: true }))
@UseGuards(ApiKeyAuthGuard) 
export class AppController {
    private readonly logger = new Logger(AppController.name);

    constructor(
        // Clients for RabbitMQ
        @Inject(EMAIL_SERVICE_RABBITMQ) private readonly emailClient: ClientProxy,
        @Inject(PUSH_SERVICE_RABBITMQ) private readonly pushClient: ClientProxy,
        private readonly prisma: PrismaService,
        private readonly userService: UserService, 
    ) {}

    // A simple endpoint required by some frameworks, although not used in the API itself
    getHello(): string {
        return 'Hello World!';
    }

    // Health Check endpoint (always outside the AuthGuard scope for monitoring)
    @Get('health')
    @HttpCode(HttpStatus.OK)
    @UseGuards() // Explicitly disable AuthGuard for health
    getHealth(): any {
        return { 
            success: true,
            message: "API Gateway status check successful.",
            data: {
                status: 'ok', 
                service: 'api_gateway',
                uptime_seconds: Math.floor(process.uptime()), 
            },
            meta: defaultMeta
        };
    }

    // --- 1. SEND NOTIFICATION ENDPOINT ---
    @Post('notifications')
    @HttpCode(HttpStatus.ACCEPTED) 
    async sendNotification(@Body() data: SendNotificationDto) {
        
        const notificationPayload = data;
        const requestId = notificationPayload.request_id;
        const notificationType = notificationPayload.notification_type;
        
        // Idempotency Check
        try {
            const existingAudit = await this.prisma.notificationAudit.findUnique({
                where: { requestId: requestId },
            });

            if (existingAudit) {
                this.logger.warn(`Idempotency hit for ${requestId}. Status: ${existingAudit.status}.`);
                return {
                    success: true,
                    message: `Idempotency check passed: Request ID ${requestId} already processed. Status: ${existingAudit.status}.`,
                    data: { 
                        request_id: requestId, 
                        status: existingAudit.status 
                    },
                    meta: defaultMeta
                };
            }
        } catch (error) {
            this.logger.error('CRITICAL: Database error during idempotency check.', error);
            throw new HttpException(
                'System error during idempotency check. Cannot proceed.',
                HttpStatus.SERVICE_UNAVAILABLE,
            );
        }
        
        // User Data Fetch (Synchronous)
        let userData: UserApiData | typeof DEFERRED_FALLBACK_SIGNAL;
        try {
            userData = await this.userService.getUserData(data.user_id);
        } catch (error) {
            // Re-throw 404 HttpExceptions from UserService (Business Error)
            throw error; 
        }

        // Circuit Breaker Fallback Check
        if (userData === DEFERRED_FALLBACK_SIGNAL) {
            await this.prisma.notificationAudit.create({
                data: {
                    requestId: requestId,
                    userId: notificationPayload.user_id,
                    notificationType: notificationType,
                    status: 'DEFERRED_CB', 
                    payload: notificationPayload as any,
                },
            });
            this.logger.warn(`User Service unavailable for ${requestId}. Request DEFERRED.`);
            return {
                success: true,
                message: `User Service unavailable. Request DEFERRED for later processing (Circuit Breaker).`,
                data: { request_id: requestId },
                meta: defaultMeta
            };
        }

        // Preference Check & Opt-Out
        const isPreferred = notificationType === NotificationType.EMAIL 
            ? userData.preferences.email 
            : userData.preferences.push;

        if (!isPreferred) {
            
            await this.prisma.notificationAudit.create({
                data: {
                    requestId: requestId,
                    userId: notificationPayload.user_id,
                    notificationType: notificationType,
                    status: 'SKIPPED_OPT_OUT', 
                    payload: notificationPayload as any,
                },
            });
            this.logger.log(`${requestId} skipped due to user opt-out for ${notificationType}.`);
            return {
                success: true,
                message: `${notificationType} request accepted but skipped due to user preference.`,
                data: { request_id: requestId },
                meta: defaultMeta
            };
        }
        
        // Payload Enrichment (MISSING TEMPLATE LOOKUP - TO BE ADDED NEXT)
        const enrichedPayload = { 
            ...notificationPayload, 
            user_id: userData.id, 
            email_address: userData.email, 
            push_token: userData.push_token,
            // The template content will be added here
        };

        // Initial Audit Log (QUEUED)
        try {
            await this.prisma.notificationAudit.create({
                data: {
                    requestId: requestId,
                    userId: notificationPayload.user_id,
                    notificationType: notificationType,
                    status: 'QUEUED', 
                    payload: enrichedPayload as any,
                }
            });
        } catch (error) {
            this.logger.error('CRITICAL: Failed to save initial audit log. Request will not be tracked!', error);
            throw new HttpException(
                'Critical system error: Failed to log request.',
                HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }
        
        // Queue Routing (Asynchronous)
        const client = notificationType === NotificationType.EMAIL 
            ? this.emailClient 
            : this.pushClient;

        // FIX: Using the standardized routing key names matching the module/bindings
        const eventPattern = notificationType === NotificationType.EMAIL
            ? 'send_email_event' // Matches the new routingKey in AppModule
            : 'send_push_event'; // Matches the new routingKey in AppModule

        client.emit(eventPattern, enrichedPayload).subscribe();
        this.logger.log(`Request ID ${requestId} queued successfully with routing key: ${eventPattern}`);
        console.log(`Emitted to ${eventPattern}:`, enrichedPayload);

        // Final Success Response
        return {
            success: true,
            message: `${notificationType} notification request accepted and queued.`,
            data: { request_id: requestId },
            meta: defaultMeta
        };
    }
    
    // --- 2. STATUS QUERY ENDPOINT ---
    @Get('notifications/:request_id')
    @HttpCode(HttpStatus.OK)
    async getNotificationStatus(@Param('request_id') requestId: string) {
        
        const audit = await this.prisma.notificationAudit.findUnique({
            where: { requestId: requestId },
            // Only select fields useful for status query
            select: {
                requestId: true,
                userId: true,
                notificationType: true,
                status: true,
                createdAt: true,
                updatedAt: true,
                failureReason: true,
            }
        });

        if (!audit) {
            throw new HttpException(
                `Notification request with ID ${requestId} not found.`,
                HttpStatus.NOT_FOUND,
            );
        }

        // Format data to match project snake_case conventions
        const responseData = {
            request_id: audit.requestId,
            user_id: audit.userId,
            notification_type: audit.notificationType,
            current_status: audit.status,
            created_at: audit.createdAt.toISOString(),
            updated_at: audit.updatedAt.toISOString(),
            // Handle parsing the failureReason JSON string back to an object
            failure_reason: audit.failureReason ? JSON.parse(audit.failureReason) : null,
        };

        return {
            success: true,
            message: `Status retrieved successfully for request ID ${requestId}.`,
            data: responseData,
            meta: defaultMeta
        };
    }
    
    // --- 3. STATUS REPORT ENDPOINT (FROM DOWNSTREAM) ---
    @Post(':notification_preference/status')
    @HttpCode(HttpStatus.OK)
    @UseGuards() // Explicitly disable AuthGuard as this is an internal callback
    async reportStatus(
        @Param('notification_preference') notificationPreference: string, 
        @Body() data: ReportStatusDto
    ) {
        
        try {
            // NOTE: We rely on the downstream service to pass the original request_id as notification_id
            await this.prisma.notificationAudit.update({
                where: {
                    requestId: data.notification_id, 
                },
                data: {
                    status: data.status, 
                    updatedAt: new Date(),
                    // Store meta data as failure reason if status is 'FAILED'
                    failureReason: data.status.toUpperCase() === 'FAILED' ? JSON.stringify(data.meta) : null,
                },
            });
            this.logger.log(`STATUS REPORT: [${notificationPreference.toUpperCase()}] ID ${data.notification_id} successfully updated to ${data.status} in DB.`);
        } catch (error) {
            // If the notification_id (requestId) is not found, Prisma throws an error
            if (error['code'] === 'P2025') {
                throw new HttpException(
                    `Cannot update status: Notification ID ${data.notification_id} not found.`, 
                    HttpStatus.NOT_FOUND
                );
            }
            this.logger.error(`ERROR updating status for ID ${data.notification_id}:`, error);
            throw new HttpException(
                `System error during status update for ID ${data.notification_id}.`, 
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
        
        return {
            success: true,
            message: `Status update for ${data.notification_id} received successfully.`,
            data: {
                notification_id: data.notification_id,
                status: data.status
            },
            meta: defaultMeta 
        };
    }
}