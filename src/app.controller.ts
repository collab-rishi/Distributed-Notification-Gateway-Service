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
  UseGuards
} from '@nestjs/common';
import { ClientProxy } from "@nestjs/microservices";

import { EMAIL_SERVICE_RABBITMQ, FAILED_SERVICE_RABBITMQ, PUSH_SERVICE_RABBITMQ } from './constants'; 
import { SendNotificationDto, ReportStatusDto, NotificationType, CreateUserDto } from './app.dto'; 
import { ApiKeyAuthGuard } from './auth.guard';
import { PrismaService } from './database/prisma.service';

@Controller() 

@UsePipes(new ValidationPipe({ transform: true }))
@UseGuards(ApiKeyAuthGuard) 
export class AppController {
 constructor(
 
    @Inject(EMAIL_SERVICE_RABBITMQ) private readonly emailClient: ClientProxy,
    @Inject(PUSH_SERVICE_RABBITMQ) private readonly pushClient: ClientProxy,
    private readonly prisma: PrismaService,
    
 ) {}


getHello() {
  return "hello";
}

  @Get('health')
  @UseGuards()
  @HttpCode(HttpStatus.OK)
  getHealth(): any {
    return { 
      status: 'ok', 
      service: 'API Gateway',
      uptime_seconds: Math.floor(process.uptime()), 
      
    };
  }

  
  @Post('notifications')
  @HttpCode(HttpStatus.ACCEPTED) // 202 Accepted for async processing
  async sendNotification(@Body() data: SendNotificationDto) {

    const notificationPayload = data;
    const requestId = notificationPayload.request_id; // For easy access

    
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
      
      console.warn('Idempotency DB check failed, proceeding to queue (RISK OF DUPLICATE):', error);
    }
    
    
    try {
      await this.prisma.notificationAudit.create({
        data: {
          requestId: requestId,
          userId: notificationPayload.user_id,
          notificationType: notificationPayload.notification_type,
          status: 'QUEUED', 
          payload: notificationPayload as any,
        },
      });
    } catch (error) {
      
      console.error('CRITICAL: Failed to save initial audit log. Request will not be tracked!', error);
      
    }
    
    
    const client = data.notification_type === NotificationType.EMAIL 
        ? this.emailClient 
        : this.pushClient;

    const eventPattern = data.notification_type === NotificationType.EMAIL
        ? 'send_email_event'
        : 'send_push_event';

    
    client.emit(eventPattern, notificationPayload).subscribe();

    
    return {
      success: true,
      message: `${data.notification_type} notification request accepted and queued.`,
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
      meta: {} 
    };
  }

}