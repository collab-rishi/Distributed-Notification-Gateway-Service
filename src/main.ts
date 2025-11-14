require('dotenv').config(); // ✅ CRITICAL FIX: Must be the first line to load ENV vars

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import * as amqplib from 'amqplib'; 


async function bootstrap() {
    // 1. Create the NestJS application instance
    const app = await NestFactory.create(AppModule);

    // 2. Configure CORS
    const corsOrigin = process.env.CORS_ORIGIN || '*';
    app.enableCors({
        origin: corsOrigin,
        methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
        allowedHeaders: 'Content-Type, Authorization',
        credentials: true,
    });

    // 3. Configure Global Settings
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ 
        transform: true, 
        whitelist: true, // Strips non-whitelisted properties
        forbidNonWhitelisted: true // Throws an error if non-whitelisted properties are sent
    }));

    // --- 4. Ensure RabbitMQ Exchange Exists (Infrastructure Setup) ---
    // This part is excellent: it guarantees the necessary exchange is present 
    // before the application starts trying to send messages.
    const rabbitUrl = process.env.RABBITMQ_URL || 'amqp://user:password@localhost:5672';
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
        process.exit(1); // Exit if infrastructure cannot be verified
    }

    // --- 5. Start HTTP Listener ---
    // Removed the explicit client.connect() calls as NestJS manages this lifecycle
    await app.listen(8080);
    console.log(`🚀 API Gateway is running on: ${await app.getUrl()}`);
}

bootstrap();