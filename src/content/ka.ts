/**
 * Georgian (primary) interface copy.
 * All user-facing text lives here so wording can be reviewed in one place
 * and further locales can be added later with the same shape.
 *
 * Copy rule: no claims about insurance, licensing, guarantees or service
 * coverage until they are verified.
 */
export const ka = {
  meta: {
    title: "პროფესიონალი მძღოლი თქვენი ავტომობილისთვის",
    description:
      "პროფესიონალი მძღოლი თქვენს ავტომობილს ერთი მისამართიდან მეორეზე გადაიყვანს. საქართველოში.",
  },

  a11y: {
    skipToContent: "მთავარ შინაარსზე გადასვლა",
    home: "მთავარი გვერდი",
    primaryNav: "მთავარი ნავიგაცია",
  },

  /** Anchors point at homepage sections added in later steps. */
  nav: [
    { label: "სერვისი", href: "#service" },
    { label: "როგორ მუშაობს", href: "#process" },
    { label: "რატომ ჩვენ", href: "#trust" },
    { label: "კითხვები", href: "#faq" },
  ],

  header: {
    cta: "დაჯავშნა",
    menuOpen: "მენიუს გახსნა",
    menuClose: "მენიუს დახურვა",
  },

  hero: {
    eyebrow: "ავტომობილის გადაყვანის სერვისი",
    titleLead: "თქვენი ავტომობილი —",
    titleAccent: "პროფესიონალის საჭესთან.",
    lead: "მიუთითეთ, საიდან და სად უნდა გადავიდეს ავტომობილი. პროფესიონალი მძღოლი თავად მივა, აიყვანს და ჩააბარებს დანიშნულების ადგილზე — თქვენ კი დროს დაზოგავთ.",
    primaryCta: "გადაყვანის დაგეგმვა",
    secondaryCta: "როგორ მუშაობს",
    /** Alt text for the future hero photograph. */
    imageAlt: "მუქი ავტომობილი ღამის გზაზე",
  },

  booking: {
    title: "დაგეგმეთ გადაყვანა",
    subtitle: "შეავსეთ რამდენიმე ველი — დანარჩენს ჩვენ შეგითანხმებთ.",
    from: "საიდან",
    to: "სად",
    when: "როდის",
    city: "ქალაქი",
    cityPlaceholder: "აირჩიეთ",
    address: "მისამართი",
    addressPlaceholder: "ქუჩა, ნომერი",
    date: "თარიღი",
    time: "სასურველი დრო",
    submit: "გაგრძელება",
    prototypeNote: "პროტოტიპი — მოთხოვნა ჯერ არ იგზავნება და არ ინახება.",
    /** Selectable cities. Listing a city is not a statement of service coverage. */
    cities: [
      "თბილისი",
      "ბათუმი",
      "ქუთაისი",
      "რუსთავი",
      "გორი",
      "ზუგდიდი",
      "ფოთი",
      "თელავი",
      "ახალციხე",
      "ზესტაფონი",
      "მარნეული",
      "მცხეთა",
      "სხვა ქალაქი",
    ],
  },

  prototype: {
    badge: "პროტოტიპი",
  },
} as const;

export type Content = typeof ka;
