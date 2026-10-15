# Puppy care research

Sources checked on 12 October 2026. The app and website use the same original summaries in [src/puppy-care.ts](src/puppy-care.ts). This is an editorial research pass, not a veterinary review.

## Scope and source selection

The library covers puppies coming home after weaning, usually around eight weeks, rather than newborn care or breeding. UK welfare organisations (Blue Cross, PDSA, Dogs Trust, RSPCA, and Battersea), the Royal Kennel Club, the American Kennel Club, and the American Veterinary Society of Animal Behavior provide the written evidence. Prefer veterinary guidance for health and infection risks and reward-based approaches for training. Advice about local law, parasite treatment, vaccines, and safe outings must remain individual to the puppy and location.

Each article section names the sources behind it. The complete article bibliography links directly to source pages or PDFs. Videos are supplementary demonstrations, not evidence for medical claims or an endorsement of a creator's entire catalogue. No paid course or product is required.

## Differences that matter

| Topic | Evidence and editorial decision |
| --- | --- |
| Toilet frequency | RSPCA suggests 45 minutes to an hour depending on age; Battersea describes hourly trips initially; Dogs Trust gives a broader two-hour routine with additional trips after activities. Present these as starting points, prioritise signals and recent food, play, or sleep, and avoid an age-to-bladder-capacity guarantee. |
| Meal frequency | Blue Cross suggests four meals from eight weeks to four months, three until six months, then two. The Royal Kennel Club offers four at two to three months and two to three at four to six months. Identify both recommendations, divide the daily allowance, and refer individual transitions to a vet. |
| Exercise | PDSA's current Exercising your puppy page explicitly says the five-minutes-per-month rule has no scientific evidence and is unsuitable for most puppies. Use that dedicated guidance rather than its older checklist's rule of thumb. |
| Vaccination and socialisation | AVSAB supports controlled early socialisation before full vaccination, with class prerequisites and avoidance of high-risk environments. Public-walk clearance still comes from the local vet. Avoid a universal final-vaccine age or waiting period. |
| Sleep and first nights | The AKC's 18–20 hour figure is an approximate total for young puppies. Blue Cross and Dogs Trust support company while settling. Crates are optional and must be introduced positively. Do not prescribe prolonged crying or a rigid enforced-nap timetable. |
| Illness | PDSA supplies emergency and symptom guidance. Blue Cross explicitly advises veterinary consultation for a puppy with vomiting or diarrhoea. Do not carry adult-dog home-care waiting periods or fasting advice into puppy guidance. |

## Verification and limits

Primary websites and indexed source extracts were researched. Several Blue Cross pages returned an automated-access 403 during full-page fetching; their indexed advice was available and was cross-checked against the other organisations listed. Do not describe that as a complete full-page review. The source register below includes all resources linked in the product.

YouTube's official oEmbed endpoint returned HTTP 200 for all four selected videos and confirmed each title and creator. The selection was checked using public descriptions and metadata; the complete videos were not watched end to end. Video titles are preserved as published. Review the whole video before expanding its techniques into written guidance.

## Visual overviews

The at-a-glance summaries draw from the same written guidance as the full articles. Their source IDs are recorded with each point and tested against the article’s bibliography. Important age ranges, individual variation, and urgent veterinary actions stay visible in the summaries.

The 12 decorative puppy illustrations were created with built-in ImageGen. Optimized JPEGs are bundled in `assets/puppy-care` for offline use; `assets/puppy-care/prompts.json` records the final prompt set and filenames. Images contain no care instructions or text: guidance remains selectable, accessible text.

## Narration

All 13 original guide summaries have bundled English ElevenLabs recordings. The spoken scripts include every section and a source note; linked reading and videos remain in the written guides. Audio is generated once and plays without an API request. See [narration provenance and noncommercial attribution requirements](assets/puppy-care/audio/README.md).

## Maintenance

Edit the shared content rather than separate app and web copies. When substantive guidance changes, recheck the affected primary sources and update the checked date. Keep section citations and related article IDs valid (npm test checks these). Prefer current dedicated guidance over older broad checklists. New sources should add a distinct perspective or support a practical claim. Never imply veterinary review or organisational endorsement unless that has actually happened. No automatic update schedule is configured.

## Written sources

- PDSA: [New puppy checklist](https://www.pdsa.org.uk/pet-help-and-advice/looking-after-your-pet/puppies-dogs/new-puppy-checklist)
- Blue Cross: [Bringing your new puppy home](https://www.bluecross.org.uk/advice/dog/wellbeing-and-care/bringing-your-new-puppy-home)
- Dogs Trust: [How to settle your puppy into your home](https://www.dogstrust.org.uk/dog-advice/puppy/new-home)
- Battersea: [How to toilet train a puppy or dog](https://www.battersea.org.uk/pet-advice/dog-advice/toilet-train-your-puppy-dog)
- RSPCA: [How to toilet train your puppy or dog](https://science.rspca.org.uk/en/web/rspca/adviceandwelfare/pets/dogs/training/toilettraining)
- Dogs Trust: [Toileting in the house](https://www.dogstrust.org.uk/dog-advice/training/unwanted-behaviours/toileting-in-the-house)
- Blue Cross: [What should I feed my puppy?](https://www.bluecross.org.uk/advice/dog/what-should-i-feed-my-puppy)
- The Royal Kennel Club: [Feeding your puppy or dog](https://www.thekennelclub.org.uk/getting-a-dog/caring-for-your-new-puppy/feeding-your-puppy-or-dog/)
- PDSA: [Puppy diet and behaviour](https://www.pdsa.org.uk/get-involved/our-campaigns/weigh-up/your-puppy/puppy-diet-and-behaviour)
- Blue Cross: [Caring for your puppy](https://www.bluecross.org.uk/advice/dog/caring-for-your-puppy)
- American Kennel Club: [How much do puppies sleep?](https://www.akc.org/expert-advice/dog-care/articles/how-much-do-puppies-sleep/)
- Blue Cross: [How to get your puppy to sleep through the night](https://www.bluecross.org.uk/advice/dog/behaviour-and-training/how-to-get-your-puppy-to-sleep-through-the-night)
- PDSA: [Exercising your puppy](https://www.pdsa.org.uk/pet-help-and-advice/looking-after-your-pet/puppies-dogs/exercising-your-puppy)
- Blue Cross: [Socialising your puppy](https://www.bluecross.org.uk/advice/dog/socialising-your-puppy)
- The Royal Kennel Club: [What is puppy socialisation?](https://www.thekennelclub.org.uk/getting-a-dog/caring-for-your-new-puppy/what-is-puppy-socialisation/)
- AVSAB: [Puppy socialization position statement (PDF)](https://avsab.org/wp-content/uploads/2024/12/Puppy-Socialization-Position-Statement-FINAL.pdf)
- AVSAB: [Humane dog training position statement (PDF)](https://avsab.org/wp-content/uploads/2024/12/AVSAB-Humane-Dog-Training-Position-Statement-2021.pdf)
- Blue Cross: [Giving your puppy an education](https://www.bluecross.org.uk/advice/dog/behaviour-and-training/giving-your-puppy-an-education)
- Dogs Trust: [Mouthing, nipping and biting](https://www.dogstrust.org.uk/dog-advice/training/unwanted-behaviours/mouthing-nipping-and-biting)
- Blue Cross: [Puppy biting and mouthing](https://www.bluecross.org.uk/advice/dog/behaviour-and-training/puppy-biting-and-mouthing)
- Blue Cross: [Preventing separation anxiety in puppies](https://www.bluecross.org.uk/advice/dog/behaviour-and-training/preventing-separation-anxiety-in-puppies)
- Dogs Trust: [Separation anxiety in dogs](https://www.dogstrust.org.uk/dog-advice/training/unwanted-behaviours/separation-anxiety)
- Blue Cross: [Dog dental care](https://www.bluecross.org.uk/advice/dog/dog-dental-care)
- Blue Cross: [Basic healthcare in dogs](https://www.bluecross.org.uk/advice/dog/health-and-injuries/basic-healthcare-in-dogs)
- PDSA: [Dog vaccines](https://www.pdsa.org.uk/pet-help-and-advice/pet-health-hub/other-veterinary-advice/dog-vaccines)
- PDSA: [First aid for pets](https://www.pdsa.org.uk/pet-help-and-advice/looking-after-your-pet/all-pets/first-aid-for-pets)
- PDSA: [My dog has eaten something harmful](https://www.pdsa.org.uk/pet-help-and-advice/pet-health-hub/symptoms/my-dog-has-eaten-something-harmful)
- PDSA: [Vomiting in dogs](https://www.pdsa.org.uk/pet-help-and-advice/pet-health-hub/symptoms/vomiting-in-dogs)
- Blue Cross: [Caring for your sick dog](https://www.bluecross.org.uk/advice/dog/caring-for-your-sick-dog)

## Videos

- Kikopup · Emily Larlham: [Puppy Training Tutorials](https://www.youtube.com/watch?v=4dbzPoB7AKk). A long-form collection of puppy training demonstrations. Choose a relevant chapter and practise one skill at a time.
- Kikopup · Emily Larlham: [Avoid errors socializing your puppy with this 30 min in depth guide](https://www.youtube.com/watch?v=HCNcq7KYANc). Demonstrations of positive early exposure. Pair this with your vet’s advice about local infection risks.
- Zak George: [How to Potty Train your Puppy EASILY! Everything you need to know!](https://www.youtube.com/watch?v=7vOXWCewEYM). A practical toilet-training demonstration. Progress varies; a video title is not a promised timescale.
- Simpawtico · Ian Stone: [How to Use the Puppy Play Den for Solid Puppy Training!](https://www.youtube.com/watch?v=pYm7baUqpew). An example of a puppy-safe rest and play area. Adapt the setup to your puppy and home.
