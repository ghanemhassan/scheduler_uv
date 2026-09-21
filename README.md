# BUA Project — Full Stack (Frontend + Backend)

Timetable, Room & Lab Allocation system — Bua University.

```
bua-project-full/
├── frontend/   React 19 + Vite + Tailwind (port 5173, proxy /api → :8000)
└── backend/    FastAPI (port 8000)
```

## Run backend
```bat
cd backend
pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --port 8000
```
Health: http://127.0.0.1:8000/api/health — Docs: http://127.0.0.1:8000/docs

### MySQL setup
The backend now persists users, timetable cells, rooms, students, schedule versions, rows, and columns in MySQL. Create the database and an application user once:

```sql
CREATE DATABASE bua_project CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'bua_user'@'localhost' IDENTIFIED BY 'change_me';
GRANT ALL PRIVILEGES ON bua_project.* TO 'bua_user'@'localhost';
FLUSH PRIVILEGES;
```

Set `DATABASE_URL` in `backend/.env` to the real credentials. On first startup the API creates its tables and seeds them from the demo data; later edits are persisted in MySQL.

## Run frontend
```bat
cd frontend
npm install
npm run dev
```
Open: http://localhost:5173 (shows API live / Offline in the toolbar)

## Demo accounts
| Role | Email | Password |
|---|---|---|
| admin | scheduler@bua.edu.eg | Admin1234 |
| admin | admin@bua.edu.eg | Admin1234 |
| lecturer | dr.chen@staff.bua.edu.eg | Staff1234 |
| lecturer | prof.nwosu@staff.bua.edu.eg | Staff1234 |
| student | amara@bua.edu.eg | Student1234 |

Offline demo mode: any `@bua.edu.eg` email + 8+ char password works when the backend is down.
