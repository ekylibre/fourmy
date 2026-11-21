import { getProcedure, unitLabel, type ItineraryDetail, type ItineraryMark, type ItkContent, type TechnicalItinerary } from "@fourmy/contracts";
import { laneOf } from "../itinerary.js";
import { anchorLabel, itkDaysBetween, scheduleSteps, type ItkDates } from "./schedule.js";

/**
 * Aperçu d'un ITK sur la frise TIKA (lot IT1) : une culture du semis à la
 * récolte d'exemple, une marque « prévue » par passage daté. Les identifiants
 * des marques sont `<étape>:<passage>` (pas des interventions).
 */
export function itkPreview(input: { name: string; color: string | null; content: Pick<ItkContent, "steps">; dates: ItkDates & { sowingOn: string; harvestOn: string } }): TechnicalItinerary {
  const scheduled = scheduleSteps(input.content, input.dates);
  const days = scheduled.flatMap((s) => s.occurrences.map((o) => o.on)).filter((d): d is string => !!d);
  const from = [input.dates.sowingOn, ...days].sort()[0]!;
  const to = [input.dates.harvestOn, ...days].sort().at(-1)!;
  const marks: ItineraryMark[] = [];
  for (const { step, occurrences } of scheduled) {
    const lane = laneOf(step.procedure);
    if (!lane) continue;
    const label = step.label?.trim() || getProcedure(step.procedure).label;
    const details: ItineraryDetail[] = [{ label: "Quand", value: anchorLabel(step.anchor) + (step.windowDays ? ` ±${step.windowDays} j` : "") }];
    if (step.share < 1) details.push({ label: "Part de la surface", value: `${Math.round(step.share * 100)} %` });
    if (step.optional) details.push({ label: "Facultative", value: "si besoin" });
    for (const i of step.inputs) details.push({ label: i.label, value: `${String(i.dose).replace(".", ",")} ${unitLabel(i.unit)}` });
    occurrences.forEach(({ occurrence, on }) => {
      if (!on) return;
      marks.push({
        interventionIds: [`${step.id}:${occurrence}`],
        procedure: step.procedure,
        label: occurrences.length > 1 ? `${label} (${occurrence + 1}/${occurrences.length})` : label,
        lane,
        status: "planned",
        at: on,
        from: on,
        to: on,
        day: itkDaysBetween(from, on),
        details,
        parcels: [],
      });
    });
  }
  return {
    title: input.name,
    campaigns: [input.dates.year],
    steps: [{ kind: "crop", campaign: input.dates.year, name: input.name, color: input.color, from, to, datesFrom: "interventions", attributes: [], marks }],
  };
}
