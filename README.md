Markdown
# RC Tractoparts - Quotation Management System (Backend)

Core REST API for the Quotation and Proforma Management System developed for **RC Tractoparts**, based on software engineering technical specifications.

## 🚀 Tech Stack
* **Runtime Environment:** Node.js
* **Framework:** Express.js
* **Database:** MySQL (using connection pooling)
* **Architecture:** Model-View-Controller (MVC) Pattern

## 🛠️ Project Setup & Installation

1. **Install dependencies:**
   ```bash
   npm install
Database Initialization:

Import the SQL schema execution script located in sql/init.sql inside your MySQL Workbench.

Environment Variables:

Create a .env file in the root directory based on .env.example.

🏃 Run the Application
Development mode: npm run dev

Run unit tests: npm run test:unit

🔒 Sprint 1 Features
HU01: Secure Authentication with JWT & Bcrypt.

HU03: Atomic Serial Number Generator (SELECT ... FOR UPDATE) to prevent concurrency duplicates (RNF10).

Guarda el archivo con `Ctrl + S`.

---