-- Profil OSRM « tracteur » pour Fourmy : le profil voiture d'OSRM, adapté.
--  * chemins (highway=track) et accès « agricultural » / « forestry » permis ;
--  * autoroutes exclues (interdites aux tracteurs) ;
--  * vitesse plafonnée à 40 km/h ;
--  * gabarit d'un tracteur avec outil (3 m de large, 4 m de haut).
-- Monté dans le conteneur en /opt/tractor.lua, à côté de /opt/lib.

dofile('/opt/car.lua')

local MAX_KMH = 40
local car_setup = setup
local car_process_way = process_way

function setup()
  local p = car_setup()
  p.properties.max_speed_for_map_matching = 60 / 3.6
  p.vehicle_width = 3.0
  p.vehicle_height = 4.0
  p.vehicle_length = 10.0
  p.vehicle_weight = 12000
  for _, tag in ipairs({ 'agricultural', 'forestry' }) do
    p.access_tag_blacklist[tag] = nil
    p.access_tag_whitelist[tag] = true
  end
  p.speeds.highway.motorway = nil
  p.speeds.highway.motorway_link = nil
  p.speeds.highway.track = 15
  p.restricted_highway_whitelist.track = true
  for k, v in pairs(p.speeds.highway) do
    p.speeds.highway[k] = math.min(v, MAX_KMH)
  end
  return p
end

function process_way(profile, way, result, relations)
  car_process_way(profile, way, result, relations)
  if result.forward_speed and result.forward_speed > MAX_KMH then result.forward_speed = MAX_KMH end
  if result.backward_speed and result.backward_speed > MAX_KMH then result.backward_speed = MAX_KMH end
end

return {
  setup = setup,
  process_way = process_way,
  process_node = process_node,
  process_turn = process_turn,
}
