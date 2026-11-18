import { Hono } from "hono";
import type { Env } from "../context.js";
import { parcelRoutes } from "./parcels.js";
import { inventoryRoutes } from "./inventory.js";
import { registerRoutes } from "./registers.js";
import { trackRoutes } from "./tracks.js";
import { interventionRoutes } from "./interventions.js";
import { syncRoutes } from "./sync.js";
import { importRoutes } from "./imports.js";
import { articleRoutes } from "./articles.js";
import { plan3dRoutes } from "./plan3d.js";
import { peopleRoutes } from "./people.js";
import { memberRoutes } from "./members.js";
import { integrationRoutes } from "./integrations.js";
import { agrirouterRoutes } from "./agrirouter.js";
import { procedureRoutes } from "./procedures.js";
import { phytoRoutes } from "./phyto.js";
import { activityRoutes } from "./activities.js";
import { certificationRoutes } from "./certifications.js";
import { equipmentRoutes } from "./equipments.js";
import { maintenanceRoutes } from "./maintenance.js";
import { crewTemplateRoutes } from "./crew-templates.js";
import { remoteSensingRoutes } from "./remote-sensing.js";
import { cropModelRoutes } from "./crop-model.js";
import { prescriptionRoutes } from "./prescriptions.js";
import { fertilizerRoutes } from "./fertilizers.js";
import { fertilizationRoutes } from "./fertilization.js";
import { farmProfileRoutes } from "./farm-profile.js";
import { ignRoutes } from "./ign.js";

/**
 * Routes métier sous `/api/v1/farms/:farmId` (architecture §5.1), découpées
 * par domaine.
 */
export const farmRoutes = new Hono<Env>()
  .route("/", farmProfileRoutes)
  .route("/", ignRoutes)
  .route("/", parcelRoutes)
  .route("/", activityRoutes)
  .route("/", certificationRoutes)
  .route("/", equipmentRoutes)
  .route("/", maintenanceRoutes)
  .route("/", inventoryRoutes)
  .route("/", registerRoutes)
  .route("/", trackRoutes)
  .route("/", interventionRoutes)
  .route("/", crewTemplateRoutes)
  .route("/", syncRoutes)
  .route("/", importRoutes)
  .route("/", articleRoutes)
  .route("/", plan3dRoutes)
  .route("/", remoteSensingRoutes)
  .route("/", cropModelRoutes)
  .route("/", prescriptionRoutes)
  .route("/", fertilizerRoutes)
  .route("/", fertilizationRoutes)
  .route("/", peopleRoutes)
  .route("/", memberRoutes)
  .route("/", integrationRoutes)
  .route("/", agrirouterRoutes)
  .route("/", procedureRoutes)
  .route("/", phytoRoutes);
