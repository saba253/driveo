/**
 * Georgian (primary) interface copy.
 * All user-facing text lives here so wording can be reviewed in one place
 * and further locales can be added later with the same shape.
 * Homepage and booking copy is added in Step 1.3.
 */
export const ka = {
  meta: {
    title: "მძღოლი თქვენი ავტომობილისთვის",
    description:
      "პროფესიონალი მძღოლი გადაიყვანს თქვენს ავტომობილს ერთი მისამართიდან მეორეზე საქართველოს მასშტაბით.",
  },
  prototype: {
    badge: "პროტოტიპი",
  },
} as const;

export type Content = typeof ka;
