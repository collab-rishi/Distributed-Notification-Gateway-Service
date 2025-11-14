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

// --- Standardized Event Patterns (Routing Keys) ---
const EMAIL_ROUTING_KEY = 'send_email_event';
const PUSH_ROUTING_KEY = 'send_push_event';
const FAILED_ROUTING_KEY = 'report_failed_event';
// --- Standardized Queue Names (Your desired physical queue identifiers) ---
const EMAIL_QUEUE_NAME = 'email.queue';
const PUSH_QUEUE_NAME = 'push.queue';
const FAILED_QUEUE_NAME = 'failed.queue';


@Module({
    imports: [
        ThrottlerModule.forRootAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (config: ConfigService) => ([ 
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
                        // The routing key matches the event pattern used in the controller's client.emit()
                        routingKey: EMAIL_ROUTING_KEY, 
                        // The queue name matches your desired physical queue identifier
                        queue: EMAIL_ROUTING_KEY, 
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
                        // The routing key matches the event pattern used in the controller's client.emit()
                        routingKey: PUSH_ROUTING_KEY, 
                        // The queue name matches your desired physical queue identifier
                        queue: PUSH_ROUTING_KEY, 
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
                        // The routing key matches the event pattern used in the controller's client.emit()
                        routingKey: FAILED_ROUTING_KEY, 
                        // The queue name matches your desired physical queue identifier
                        queue: FAILED_QUEUE_NAME, 
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