# BatchMatch Technology Stack Decision

Last Updated: 2026-07-19

---

# Philosophy

BatchMatch dibangun sebagai web application yang modular.

Target:

- mudah dikembangkan
- scalable
- enterprise-ready
- AI-ready

---

# Frontend

Framework

React

Reason

- Mature
- Ecosystem besar
- Cocok untuk dashboard

Build Tool

Vite

Reason

Fast build dan development.

UI

TailwindCSS

Reason

Utility-first.

Icons

Lucide React

State

React Context

Future

TanStack Query

---

# Backend

Framework

Laravel 13

Reason

- REST API
- Queue
- Authentication
- Storage
- Validation
- Mature ecosystem

---

# Database

Development

MySQL (Laragon)

Production

MySQL / PostgreSQL

SQLite hanya digunakan bila diperlukan untuk testing sederhana.

---

# Authentication

Laravel Sanctum

Reason

SPA authentication.

---

# Storage

Laravel Storage

Future

S3 Compatible Storage

---

# Matching Engine

MVP

Laravel Service Layer

Reason

Mengurangi kompleksitas deployment.

Future

Python Matching Service

Jika:

- Dataset sangat besar
- RapidFuzz
- Splink
- Machine Learning
- Embedding

maka Matching Engine dipisahkan menjadi microservice.

---

# AI

API Based

Provider dapat diganti.

OpenAI

Anthropic

Azure OpenAI

Google Gemini

melalui adapter.

---

# Export

Laravel

CSV

XLSX

JSON

Future

Parquet

SQLite

ZIP Package

---

# Deployment

Development

Laragon

Production

Linux

Nginx

PHP-FPM

Supervisor

Queue Worker

---

# Coding Principles

- Thin Controller
- Service Layer
- Repository bila diperlukan
- Interface Based
- SOLID
- DRY
- KISS

---

# Decisions

2026-07-19

✓ React dipertahankan.

✓ Laravel menjadi backend utama.

✓ Matching Engine tetap berada di Laravel untuk MVP.

✓ Python belum digunakan.

✓ MySQL menjadi database utama.

✓ AI menggunakan adapter.

✓ API menjadi satu-satunya komunikasi Frontend ↔ Backend.

✓ Seluruh fitur harus mengikuti PRD.
