# BUA Timetable and Room Scheduling System

A web application for managing academic timetables and room allocations, with tools for tracking scheduling conflicts, students, and faculty members.

## Project Structure

- `frontend/`: React and TypeScript user interface powered by Vite.
- `backend/`: FastAPI service with SQLAlchemy-based data storage.
- `docs/`: Project documentation.

## Requirements

- Python 3.10 or later.
- Node.js 20 or later and npm.
- SQLite for the default local setup. MySQL is also supported through `DATABASE_URL`.

## Local Development

### Backend

```bash
cd backend
python -m venv .venv
```

Activate the virtual environment, install the dependencies, and start the API:

```bash
# Windows PowerShell: .venv\Scripts\Activate.ps1
# macOS / Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

The backend uses SQLite by default and creates the database on startup. To configure environment variables, copy `backend/.env.example` to `backend/.env` and update the values for your setup.

### Frontend

In a separate terminal:

```bash
cd frontend
npm install
npm run dev
```

Open the Vite URL shown in the terminal. It is usually `http://localhost:5173`. The API documentation is available at `http://127.0.0.1:8000/docs`, and the health endpoint is `http://127.0.0.1:8000/api/health`.

## MySQL Setup (Optional)

Create a database and a dedicated application user, then set the connection URL in `backend/.env`:

```env
DATABASE_URL=mysql+pymysql://bua_user:your_password@127.0.0.1:3306/bua_project
```

Never commit `.env` files or real credentials to Git.

## API

API routes are available under `/api`. Once the backend is running, use `/docs` to browse the interactive Swagger documentation.

## Security Notes

Bundled accounts and sample data are intended for local development. Before deployment, use strong environment-specific passwords and secrets, and restrict `CORS_ORIGINS` to trusted frontend domains.
