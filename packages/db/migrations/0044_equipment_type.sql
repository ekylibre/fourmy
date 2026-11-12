-- Type de matériel (semoir, charrue, pulvérisateur porté…), plus fin que la
-- nature Ekylibre (`kind`) : il porte l'avatar 3D de base (docs/materiels.md).
-- Null : non renseigné, l'avatar se déduit alors du nom.
ALTER TABLE equipments ADD COLUMN equipment_type text CHECK (length(equipment_type) <= 40);
