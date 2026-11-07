"""Service agronomique Fourmy — squelette (ADR-1).

Sans état : il reçoit des données, rend des résultats, ne touche jamais la
base. L'API Fourmy l'appelle en HTTP. Les méthodes métier (bilans azotés,
modèles agronomiques, rasters/télédétection, ML) viennent après la tranche ;
leurs contrats dériveront de l'OpenAPI de @fourmy/contracts.
"""

from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="Fourmy — services/agro", version="0.0.0")


class Health(BaseModel):
    status: str
    service: str


@app.get("/health", response_model=Health)
def health() -> Health:
    return Health(status="ok", service="fourmy-agro")


# --- Exemple de la forme d'une future méthode (non implémentée) -------------
class NitrogenBalanceInput(BaseModel):
    """Entrée d'un futur bilan azoté (illustration du contrat, pas de calcul)."""

    parcel_area_ha: float
    crop: str
    supplies_kg_n_per_ha: float
    needs_kg_n_per_ha: float


class NitrogenBalanceResult(BaseModel):
    balance_kg_n_per_ha: float


@app.post("/methods/nitrogen-balance", response_model=NitrogenBalanceResult)
def nitrogen_balance(_input: NitrogenBalanceInput) -> NitrogenBalanceResult:
    # À implémenter après la tranche (méthode métier).
    raise NotImplementedError("bilan azoté — à implémenter")
