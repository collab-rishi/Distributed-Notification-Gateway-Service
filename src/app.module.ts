import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from "@nestjs/microservices"; 
import { EMAIL_SERVICE_RABBITMQ, PUSH_SERVICE_RABBITMQ, FAILED_SERVICE_RABBITMQ } from "./constants"; 
import { DatabaseModule } from './database/database.module';
import { PrismaService } from './database/prisma.service';


@Module({
  imports: [
   
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
  providers: [PrismaService], 
})
export class AppModule {}