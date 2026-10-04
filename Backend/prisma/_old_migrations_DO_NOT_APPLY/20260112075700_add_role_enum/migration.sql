-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');

-- CreateTable
CREATE TABLE "brands" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kv_store_9bf79e4a" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "kv_store_9bf79e4a_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "products" (
    "id" BIGSERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "description" TEXT,
    "sku" TEXT,
    "categories" TEXT[],
    "flavors" TEXT[],
    "url" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" BIGSERIAL NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "email_verified" BOOLEAN DEFAULT false,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "last_login" TIMESTAMP(6),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "brands_name_key" ON "brands"("name");

-- CreateIndex
CREATE INDEX "kv_store_9bf79e4a_key_idx" ON "kv_store_9bf79e4a"("key");

-- CreateIndex
CREATE INDEX "kv_store_9bf79e4a_key_idx1" ON "kv_store_9bf79e4a"("key");

-- CreateIndex
CREATE INDEX "kv_store_9bf79e4a_key_idx2" ON "kv_store_9bf79e4a"("key");

-- CreateIndex
CREATE INDEX "kv_store_9bf79e4a_key_idx3" ON "kv_store_9bf79e4a"("key");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
