require('dotenv').config(); // ✅ CRITICAL FIX: Must be the first line to load ENV vars

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import * as amqplib from 'amqplib'; 


async function bootstrap() {
  
    const app = await NestFactory.create(AppModule);


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
        whitelist: true, 
        forbidNonWhitelisted: true 
    }));

    
    const rabbitUrl = process.env.RABBITMQ_URL || 'amqp://nqdlzpvs:Tj5-G0boaSyrS1nZFM4aL9ElaiSeKTmW@chameleon.lmq.cloudamqp.com/nqdlzpvs';
    const EXCHANGE_NAME = 'notifications.direct';

    console.log(`--- Ensuring "${EXCHANGE_NAME}" exchange exists ---`);
    try {
        const connection = await amqplib.connect(rabbitUrl);
        const channel = await connection.createChannel();
        await channel.assertExchange(EXCHANGE_NAME, 'direct', { durable: true });
        await channel.close();
        await connection.close();
        console.log(`✅ Exchange "${EXCHANGE_NAME}" verified/created.`);
    } catch (error) {
        console.error(`🚨 CRITICAL ERROR: Failed to connect to or assert RabbitMQ exchange. Check RABBITMQ_URL in .env.`);
        console.error(error);
        process.exit(1); 
    }

   
    await app.listen(8080);
    console.log(`🚀 API Gateway is running on: ${await app.getUrl()}`);
}

bootstrap();