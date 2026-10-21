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

  service: {
    eyebrow: "სერვისი",
    title: "თქვენი ავტომობილი მიდის. თქვენ — არა.",
    intro:
      "მძღოლი მოდის მითითებულ მისამართზე, იღებს თქვენს ავტომობილს და თავად მართავს მას დანიშნულების ადგილამდე.",
    note: {
      title: "ეს არ არის ევაკუატორი",
      text: "ავტომობილს არ ვტვირთავთ ევაკუატორზე ან ავტომზიდზე — მას მძღოლი თავად მართავს. ამიტომ ავტომობილი უნდა იყოს სავალ მდგომარეობაში.",
    },
    useCasesLabel: "როდის გამოგადგებათ",
    useCases: [
      {
        title: "პირადი ავტომობილის გადაყვანა",
        text: "სერვისცენტრში, აეროპორტში, ახალ მისამართზე ან ნებისმიერ ადგილას, სადაც ავტომობილი გჭირდებათ — თქვენ კი იქ ყოფნა არ შეგიძლიათ.",
      },
      {
        title: "ქირავნობა და ავტოსალონები",
        text: "ავტომობილის მიწოდება კლიენტამდე, დაბრუნება ფილიალში ან გადაადგილება ლოკაციებს შორის.",
      },
      {
        title: "ქალაქებს შორის",
        text: "ავტომობილი სხვა ქალაქში დაგხვდებათ — თქვენ კი შეგიძლიათ იმგზავროთ ისე, როგორც გსურთ.",
      },
    ],
  },

  process: {
    eyebrow: "პროცესი",
    title: "როგორ მუშაობს",
    steps: [
      {
        title: "მოთხოვნა",
        text: "ავსებთ მოთხოვნას: საიდან, სად და როდის.",
      },
      {
        title: "შეთანხმება",
        text: "მძღოლი გიკავშირდებათ და გითანხმებთ ფასსა და პირობებს.",
      },
      {
        title: "გადაყვანა",
        text: "შეთანხმების შემდეგ მძღოლი იღებს ავტომობილს და ჩააბარებს დანიშნულების ადგილზე.",
      },
    ],
  },

  /**
   * No insurance, licensing, guarantee or certification claims here until verified.
   * The title reflects the current single-driver model — revisit if drivers are added.
   */
  trust: {
    eyebrow: "რატომ ჩვენ",
    title: "ერთი ადამიანი — მოთხოვნიდან ჩაბარებამდე.",
    intro: "თქვენ ესაუბრებით იმავე ადამიანს, ვინც თქვენს ავტომობილს მართავს.",
    points: [
      {
        icon: "chat",
        title: "პირდაპირი კომუნიკაცია",
        text: "კითხვებს პასუხობს მძღოლი — შუამავლებისა და ქოლ-ცენტრის გარეშე.",
      },
      {
        icon: "tag",
        title: "ფასი დადასტურებამდე",
        text: "ფასსა და პირობებს წინასწარ შეგითანხმებთ. გადაყვანა მხოლოდ თქვენი დადასტურების შემდეგ ხდება.",
      },
      {
        icon: "clipboard",
        title: "მდგომარეობის ფიქსაცია",
        text: "ავტომობილის მიღებისას და ჩაბარებისას მის მდგომარეობას ერთად ვაფიქსირებთ.",
      },
    ],
  },

  /**
   * `review` marks answers that depend on business policy not yet decided.
   * It is never rendered — resolve each with the founder before launch.
   */
  faq: {
    eyebrow: "კითხვები",
    title: "ხშირად დასმული კითხვები",
    items: [
      {
        q: "როგორ მუშაობს მოთხოვნა?",
        a: "საიტზე მიუთითებთ მარშრუტს, თარიღსა და სასურველ დროს. მოთხოვნის გაგზავნა ჯერ არ ნიშნავს დაჯავშნას: მძღოლი დაგიკავშირდებათ, შეგითანხმებთ ფასსა და პირობებს და გადაყვანა მხოლოდ თქვენი დადასტურების შემდეგ დაიგეგმება.",
        review: null,
      },
      {
        q: "უნდა ვიყო თუ არა ადგილზე?",
        a: "ავტომობილის გადაცემისა და მიღებისას ადგილზე უნდა იყოთ თქვენ ან თქვენ მიერ მითითებული პირი — გასაღების გადასაცემად და ავტომობილის მდგომარეობის ერთად დასაფიქსირებლად. დეტალებს წინასწარ შევათანხმებთ.",
        review: "Is unattended handover (e.g. keys left at a service centre) ever allowed?",
      },
      {
        q: "ვინ იხდის საწვავის ხარჯს?",
        a: "საწვავის საკითხს ფასთან ერთად შევათანხმებთ, გადაყვანის დადასტურებამდე.",
        review: "Decide the fuel policy: included in price, paid by customer, or tank-level based.",
      },
      {
        q: "რომელ ქალაქებში მუშაობთ?",
        a: "მომსახურება საქართველოს ფარგლებში იგეგმება. კონკრეტული ქალაქისა და მარშრუტის ხელმისაწვდომობას მოთხოვნის განხილვისას დაგიდასტურებთ.",
        review: "Confirm served cities/regions and whether any routes are excluded.",
      },
      {
        q: "შესაძლებელია თუ არა საერთაშორისო გადაყვანა?",
        a: "ამ ეტაპზე მოთხოვნებს მხოლოდ საქართველოს შიგნით განვიხილავთ.",
        review: "Confirm international transfers are out of scope.",
      },
    ],
  },

  finalCta: {
    eyebrow: "დაჯავშნა",
    title: "დაგეგმეთ შემდეგი გადაყვანა.",
    text: "მიუთითეთ მარშრუტი და დრო — დანარჩენს ერთად შევათანხმებთ.",
    button: "მოთხოვნის შევსება",
  },

  footer: {
    tagline: "ავტომობილის გადაყვანის სერვისი საქართველოში.",
    navLabel: "ქვედა ნავიგაცია",
    contactTitle: "კონტაქტი",
    contactLabels: { phone: "ტელეფონი", email: "ელფოსტა", telegram: "Telegram" },
    contactPending: "მალე დაემატება",
    prototypeNote: "საიტი პროტოტიპის რეჟიმშია — მოთხოვნები ჯერ არ იგზავნება.",
    backToTop: "ზემოთ",
  },

  prototype: {
    badge: "პროტოტიპი",
  },
} as const;

export type Content = typeof ka;
