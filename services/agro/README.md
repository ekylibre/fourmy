# services/agro

Service Python **sans état** pour les méthodes agronomiques de Fourmy (ADR-1).
Squelette : seul `/health` est implémenté. Les méthodes métier (bilans azotés,
modèles, rasters, ML) viennent après la première tranche.

```bash
uv sync
uv run uvicorn app.main:app --reload
uv run pytest
```
