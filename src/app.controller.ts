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
  HttpException
} from '@nestjs/common';
import { ClientProxy } from "@nestjs/microservices";

import { EMAIL_SERVICE_RABBITMQ, PUSH_SERVICE_RABBITMQ } from './constants'; 
import { SendNotificationDto, ReportStatusDto, NotificationType } from './app.dto'; 
import { ApiKeyAuthGuard } from './auth.guard';
import { PrismaService } from './database/prisma.service';

import { UserService, DEFERRED_FALLBACK_SIGNAL } from './user-service/user-service.service'; 


@Controller() 

@UsePipes(new ValidationPipe({ transform: true }))
@UseGuards(ApiKeyAuthGuard) 
export class AppController {
  constructor(
   
    @Inject(EMAIL_SERVICE_RABBITMQ) private readonly emailClient: ClientProxy,
    @Inject(PUSH_SERVICE_RABBITMQ) private readonly pushClient: ClientProxy,
    private readonly prisma: PrismaService,
    private readonly userService: UserService, 
  ) {}


  getHello() {
    return "hello";
  }

  @Get('health')
  
  @HttpCode(HttpStatus.OK)
 
  getHealth(): any {
    return { 
      status: 'ok', 
      service: 'API Gateway',
      uptime_seconds: Math.floor(process.uptime()), 
    };
  }

  
  @Post('notifications')
  @HttpCode(HttpStatus.ACCEPTED) 
  async sendNotification(@Body() data: SendNotificationDto) {

    
    const notificationPayload = data;
    const requestId = notificationPayload.request_id;
    const notificationType = notificationPayload.notification_type;
    

    try {
      const existingAudit = await this.prisma.notificationAudit.findUnique({
        where: { requestId: requestId },
      });

      if (existingAudit) {
        return {
          success: true,
          message: `Idempotency check passed: Request ID ${requestId} already processed. Status: ${existingAudit.status}.`,
          data: { request_id: requestId },
          meta: { total: 1, limit: 1, page: 1, total_pages: 1, has_next: false, has_previous: false }
        };
      }
    } catch (error) {
      throw new HttpException(
        'System error during idempotency check. Cannot proceed.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    

  
    let userData: any;
    try {
    
      userData = await this.userService.getUserData(data.user_id);
      
    } catch (error) {

      throw error; 
    }


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

        return {
            success: true,
            message: `User Service unavailable. Request DEFERRED for later processing (Circuit Breaker).`,
            data: { request_id: requestId },
            meta: { total: 1, limit: 1, page: 1, total_pages: 1, has_next: false, has_previous: false }
        };
    }


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

      return {
        success: true,
        message: `${notificationType} request accepted but skipped due to user preference.`,
        data: { request_id: requestId },
        meta: { total: 1, limit: 1, page: 1, total_pages: 1, has_next: false, has_previous: false }
      };
    }
    
  
    const enrichedPayload = { 
        ...notificationPayload, 
        email_address: userData.email, 
        push_token: userData.push_token 
    };

    try {
      await this.prisma.notificationAudit.create({
        data: {
          requestId: requestId,
          userId: notificationPayload.user_id,
          notificationType: notificationPayload.notification_type,
          status: 'QUEUED', 
          payload: enrichedPayload as any,
        }
      });
    } catch (error) {
      console.error('CRITICAL: Failed to save initial audit log. Request will not be tracked!', error);
      throw new HttpException(
        'Critical system error: Failed to log request.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    

    const client = notificationType === NotificationType.EMAIL 
        ? this.emailClient 
        : this.pushClient;

    const eventPattern = notificationType === NotificationType.EMAIL
        ? 'send_email_event'
        : 'send_push_event';

  
    client.emit(eventPattern, enrichedPayload);

    
    return {
      success: true,
      message: `${notificationType} notification request accepted and queued.`,
      data: { 
          request_id: requestId
      },
      meta: {
          total: 1, limit: 1, page: 1, total_pages: 1, has_next: false, has_previous: false 
      }
    };
  }


  @Post(':notification_preference/status')
  @HttpCode(HttpStatus.OK)
  async reportStatus(
    @Param('notification_preference') notificationPreference: string, 
    @Body() data: ReportStatusDto
  ) {
    
    try {
      await this.prisma.notificationAudit.update({
        where: {
          requestId: data.notification_id, 
        },
        data: {
          status: data.status, 
          updatedAt: new Date(),
          failureReason: data.status === 'failed' ? JSON.stringify(data.meta) : null,
        },
      });
      console.log(`STATUS REPORT: [${notificationPreference.toUpperCase()}] ID ${data.notification_id} successfully updated to ${data.status} in DB.`);
    } catch (error) {
      console.error(`ERROR updating status for ID ${data.notification_id}:`, error);
    }
    
    return {
      success: true,
      message: `Status update for ${data.notification_id} received successfully.`,
      data: {
          notification_id: data.notification_id,
          status: data.status
      },
      meta: {total: 1, limit: 1, page: 1, total_pages: 1, has_next: false, has_previous: false} 
    };
  }
}