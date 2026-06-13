dev:
	docker compose up --build

stop:
	docker compose down

logs:
	docker compose logs -f

db-push:
	docker compose exec backend npm run db:push

seed:
	docker compose exec backend npm run db:seed

frontend:
	cd services/frontend && npm run dev

backend:
	cd services/backend && npm run dev

ai:
	cd services/ai-service && uvicorn main:app --reload --port 8001
