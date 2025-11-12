import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { EMAIL_SERVICE_RABBITMQ, PUSH_SERVICE_RABBITMQ, FAILED_SERVICE_RABBITMQ } from './constants';
import * as amqplib from 'amqplib'; 
require('dotenv').config();

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable CORS. Use CORS_ORIGIN env var in production to restrict origin.
  const corsOrigin = process.env.CORS_ORIGIN || '*';
  app.enableCors({
    origin: corsOrigin,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type, Authorization',
    credentials: true,
  });

  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ 
    transform: true, 
    whitelist: true 
  }));

  // --- ✅ STEP 1: Ensure RabbitMQ Exchange Exists ---
  const rabbitUrl = process.env.RABBITMQ_URL || 'amqp://user:password@localhost:5672';

  console.log('--- Ensuring "notifications.direct" exchange exists ---');
  const connection = await amqplib.connect(rabbitUrl);
  const channel = await connection.createChannel();
  await channel.assertExchange('notifications.direct', 'direct', { durable: true });
  await channel.close();
  await connection.close();
  console.log('✅ Exchange "notifications.direct" verified/created.');

  // --- STEP 2: Connect Clients ---
  const emailClient = app.get<ClientProxy>(EMAIL_SERVICE_RABBITMQ);
  const pushClient = app.get<ClientProxy>(PUSH_SERVICE_RABBITMQ);
  const failedClient = app.get<ClientProxy>(FAILED_SERVICE_RABBITMQ);

  console.log('--- Connecting to RabbitMQ Clients ---');
  await Promise.all([
    emailClient.connect(),
    pushClient.connect(),
    failedClient.connect(),
  ]);
  console.log('✅ All RabbitMQ clients connected successfully.');

  // --- STEP 3: Start HTTP Listener ---
  await app.listen(8080);
  console.log(`🚀 API Gateway is running on: ${await app.getUrl()}`);
}

bootstrap();
