FROM php:8.3-cli

# Install system dependencies & libraries
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    unzip \
    libpng-dev \
    libjpeg-dev \
    libfreetype6-dev \
    libzip-dev \
    libonig-dev \
    libxml2-dev \
    default-mysql-client \
    && docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install -j$(nproc) \
        pdo_mysql \
        bcmath \
        gd \
        zip \
        mbstring \
        pcntl \
        opcache \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Configure custom PHP settings for file uploads and memory limit
RUN echo "upload_max_filesize = 64M" > /usr/local/etc/php/conf.d/uploads.ini \
    && echo "post_max_size = 64M" >> /usr/local/etc/php/conf.d/uploads.ini \
    && echo "memory_limit = 512M" >> /usr/local/etc/php/conf.d/uploads.ini \
    && echo "max_execution_time = 300" >> /usr/local/etc/php/conf.d/uploads.ini

# Install Composer
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

# Set working directory
WORKDIR /var/www/html

# Copy composer files first to leverage Docker layer caching
COPY composer.json composer.lock* ./

# Install dependencies if lock file is present (or without dev in prod, but with dev for local)
RUN composer install --no-interaction --no-scripts --prefer-dist || true

# Copy the rest of the application
COPY . .

# Ensure storage and bootstrap cache permissions
RUN chmod -R 775 storage bootstrap/cache 2>/dev/null || true

# Expose Laravel default port
EXPOSE 8000

# Default command
CMD ["php", "artisan", "serve", "--host=0.0.0.0", "--port=8000"]
