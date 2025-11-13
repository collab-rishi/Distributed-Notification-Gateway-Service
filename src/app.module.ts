import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from "@nestjs/microservices"; 
import { EMAIL_SERVICE_RABBITMQ, PUSH_SERVICE_RABBITMQ, FAILED_SERVICE_RABBITMQ } from "./constants"; 
import { DatabaseModule } from './database/database.module';
import { PrismaService } from './database/prisma.service';
import { HttpModule } from '@nestjs/axios';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ApiKeyAuthGuard } from './auth.guard';
import { UserService } from './user-service/user-service.service';

@Module({
  imports: [
    // 🔑 FIX: Wrapped configuration in an array to match ThrottlerModuleOptions type
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ([ // <-- Notice the square brackets
        {
          // Rate limit: 10 requests per 60 seconds (configurable via env)
          ttl: config.get<number>('THROTTLE_TTL') || 60, 
          limit: config.get<number>('THROTTLE_LIMIT') || 10,
        }
      ]),
    }),
    HttpModule,
    
    ConfigModule.forRoot({
      isGlobal: true, 
    }),
    DatabaseModule,
    
    ClientsModule.registerAsync([ 	 
      {
        name: EMAIL_SERVICE_RABBITMQ,
        useFactory: (configService: ConfigService) => ({
            transport: Transport.RMQ,
            options: {
                urls: [configService.get<string>('RABBITMQ_URL', 'amqp://user:password@localhost:5672')],
                exchange: 'notifications.direct', 
                exchangeOptions: {
                  type: 'direct', 
                  durable: true,
                  assert: true,
                },
                routingKey: 'email.queue', 
                queue: "email.queue", 
                queueOptions: { 
                  durable: true,
                  assert: true
                },
            },
        }),
        inject: [ConfigService], 
      },
      {
        name: PUSH_SERVICE_RABBITMQ,
        useFactory: (configService: ConfigService) => ({
            transport: Transport.RMQ,
            options: {
                urls: [configService.get<string>('RABBITMQ_URL', 'amqp://user:password@localhost:5672')],
                exchange: 'notifications.direct', 
                exchangeOptions: {
                  type: 'direct', 
                  durable: true,
                  assert: true,
                },
                routingKey: 'push.queue', 
                queue: "push.queue", 
                queueOptions: { 
                  durable: true,
                  assert: true 
                },
            },
        }),
        inject: [ConfigService],
      },
      {
        name: FAILED_SERVICE_RABBITMQ,
        useFactory: (configService: ConfigService) => ({
            transport: Transport.RMQ,
            options: {
                urls: [configService.get<string>('RABBITMQ_URL', 'amqp://user:password@localhost:5672')],
                exchange: 'notifications.direct', 
                exchangeOptions: {
                  type: 'direct', 
                  durable: true,
                  assert: true,

                },
                routingKey: 'failed.queue', 
                queue: "failed.queue", 
                queueOptions: { 
                  durable: true,
                  assert: true 
                },
            },
        }),
        inject: [ConfigService],
      },
    ]),
    
    DatabaseModule,
    
  ],
  controllers: [AppController],
  providers: [
    PrismaService, 
    UserService, 
    
    // Global Guards: Applied in order
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard, 
    },
    {
      provide: APP_GUARD,
      useClass: ApiKeyAuthGuard,
    },
  ], 
})
export class AppModule {}