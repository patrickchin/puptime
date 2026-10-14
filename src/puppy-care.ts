export type CareSource = { publisher: string; title: string; url: string; kind?: 'video'; note?: string };
export type CareSection = { title: string; paragraphs: string[]; sources: string[] };
export type CareImage = 'home' | 'potty' | 'feeding' | 'sleep' | 'play' | 'social' | 'training' | 'chewing' | 'alone' | 'grooming' | 'vet' | 'urgent';
export type CareGlance = { label: string; value: string; detail: string; sources: string[] };
export type CareArticle = {
  id: string; title: string; summary: string; category: 'Basics' | 'Daily care' | 'Training' | 'Health';
  shortTitle: string; image: CareImage; glance: CareGlance[];
  sections: CareSection[]; related: string[]; videos?: string[];
};

// Original summaries of the linked sources, not copied articles. See PUPPY_CARE_RESEARCH.md.
export const careReviewedOn = '12 October 2026';
export const careSources: Record<string, CareSource> = {
  checklist: { publisher: 'PDSA', title: 'New puppy checklist', url: 'https://www.pdsa.org.uk/pet-help-and-advice/looking-after-your-pet/puppies-dogs/new-puppy-checklist' },
  home: { publisher: 'Blue Cross', title: 'Bringing your new puppy home', url: 'https://www.bluecross.org.uk/advice/dog/wellbeing-and-care/bringing-your-new-puppy-home' },
  settle: { publisher: 'Dogs Trust', title: 'How to settle your puppy into your home', url: 'https://www.dogstrust.org.uk/dog-advice/puppy/new-home' },
  potty: { publisher: 'Battersea', title: 'How to toilet train a puppy or dog', url: 'https://www.battersea.org.uk/pet-advice/dog-advice/toilet-train-your-puppy-dog' },
  pottyRspca: { publisher: 'RSPCA', title: 'How to toilet train your puppy or dog', url: 'https://science.rspca.org.uk/en/web/rspca/adviceandwelfare/pets/dogs/training/toilettraining' },
  accidents: { publisher: 'Dogs Trust', title: 'Toileting in the house', url: 'https://www.dogstrust.org.uk/dog-advice/training/unwanted-behaviours/toileting-in-the-house' },
  food: { publisher: 'Blue Cross', title: 'What should I feed my puppy?', url: 'https://www.bluecross.org.uk/advice/dog/what-should-i-feed-my-puppy' },
  foodKc: { publisher: 'The Royal Kennel Club', title: 'Feeding your puppy or dog', url: 'https://www.thekennelclub.org.uk/getting-a-dog/caring-for-your-new-puppy/feeding-your-puppy-or-dog/' },
  diet: { publisher: 'PDSA', title: 'Puppy diet and behaviour', url: 'https://www.pdsa.org.uk/get-involved/our-campaigns/weigh-up/your-puppy/puppy-diet-and-behaviour' },
  care: { publisher: 'Blue Cross', title: 'Caring for your puppy', url: 'https://www.bluecross.org.uk/advice/dog/caring-for-your-puppy' },
  sleep: { publisher: 'American Kennel Club', title: 'How much do puppies sleep?', url: 'https://www.akc.org/expert-advice/dog-care/articles/how-much-do-puppies-sleep/' },
  night: { publisher: 'Blue Cross', title: 'How to get your puppy to sleep through the night', url: 'https://www.bluecross.org.uk/advice/dog/behaviour-and-training/how-to-get-your-puppy-to-sleep-through-the-night' },
  exercise: { publisher: 'PDSA', title: 'Exercising your puppy', url: 'https://www.pdsa.org.uk/pet-help-and-advice/looking-after-your-pet/puppies-dogs/exercising-your-puppy' },
  social: { publisher: 'Blue Cross', title: 'Socialising your puppy', url: 'https://www.bluecross.org.uk/advice/dog/socialising-your-puppy' },
  socialKc: { publisher: 'The Royal Kennel Club', title: 'What is puppy socialisation?', url: 'https://www.thekennelclub.org.uk/getting-a-dog/caring-for-your-new-puppy/what-is-puppy-socialisation/' },
  socialVet: { publisher: 'AVSAB', title: 'Puppy socialization position statement (PDF)', url: 'https://avsab.org/wp-content/uploads/2024/12/Puppy-Socialization-Position-Statement-FINAL.pdf' },
  trainingVet: { publisher: 'AVSAB', title: 'Humane dog training position statement (PDF)', url: 'https://avsab.org/wp-content/uploads/2024/12/AVSAB-Humane-Dog-Training-Position-Statement-2021.pdf' },
  education: { publisher: 'Blue Cross', title: 'Giving your puppy an education', url: 'https://www.bluecross.org.uk/advice/dog/behaviour-and-training/giving-your-puppy-an-education' },
  bite: { publisher: 'Dogs Trust', title: 'Mouthing, nipping and biting', url: 'https://www.dogstrust.org.uk/dog-advice/training/unwanted-behaviours/mouthing-nipping-and-biting' },
  biteBlue: { publisher: 'Blue Cross', title: 'Puppy biting and mouthing', url: 'https://www.bluecross.org.uk/advice/dog/behaviour-and-training/puppy-biting-and-mouthing' },
  alone: { publisher: 'Blue Cross', title: 'Preventing separation anxiety in puppies', url: 'https://www.bluecross.org.uk/advice/dog/behaviour-and-training/preventing-separation-anxiety-in-puppies' },
  separation: { publisher: 'Dogs Trust', title: 'Separation anxiety in dogs', url: 'https://www.dogstrust.org.uk/dog-advice/training/unwanted-behaviours/separation-anxiety' },
  dental: { publisher: 'Blue Cross', title: 'Dog dental care', url: 'https://www.bluecross.org.uk/advice/dog/dog-dental-care' },
  healthcare: { publisher: 'Blue Cross', title: 'Basic healthcare in dogs', url: 'https://www.bluecross.org.uk/advice/dog/health-and-injuries/basic-healthcare-in-dogs' },
  vaccines: { publisher: 'PDSA', title: 'Dog vaccines', url: 'https://www.pdsa.org.uk/pet-help-and-advice/pet-health-hub/other-veterinary-advice/dog-vaccines' },
  firstAid: { publisher: 'PDSA', title: 'First aid for pets', url: 'https://www.pdsa.org.uk/pet-help-and-advice/looking-after-your-pet/all-pets/first-aid-for-pets' },
  poison: { publisher: 'PDSA', title: 'My dog has eaten something harmful', url: 'https://www.pdsa.org.uk/pet-help-and-advice/pet-health-hub/symptoms/my-dog-has-eaten-something-harmful' },
  vomiting: { publisher: 'PDSA', title: 'Vomiting in dogs', url: 'https://www.pdsa.org.uk/pet-help-and-advice/pet-health-hub/symptoms/vomiting-in-dogs' },
  sickPuppy: { publisher: 'Blue Cross', title: 'Caring for your sick dog', url: 'https://www.bluecross.org.uk/advice/dog/caring-for-your-sick-dog' },
  kikoBasics: { publisher: 'Kikopup · Emily Larlham', title: 'Puppy Training Tutorials', url: 'https://www.youtube.com/watch?v=4dbzPoB7AKk', kind: 'video', note: 'A long-form collection of puppy training demonstrations. Choose a relevant chapter and practise one skill at a time.' },
  kikoSocial: { publisher: 'Kikopup · Emily Larlham', title: 'Avoid errors socializing your puppy with this 30 min in depth guide', url: 'https://www.youtube.com/watch?v=HCNcq7KYANc', kind: 'video', note: 'Demonstrations of positive early exposure. Pair this with your vet’s advice about local infection risks.' },
  zakPotty: { publisher: 'Zak George', title: 'How to Potty Train your Puppy EASILY! Everything you need to know!', url: 'https://www.youtube.com/watch?v=7vOXWCewEYM', kind: 'video', note: 'A practical toilet-training demonstration. Progress varies; a video title is not a promised timescale.' },
  playDen: { publisher: 'Simpawtico · Ian Stone', title: 'How to Use the Puppy Play Den for Solid Puppy Training!', url: 'https://www.youtube.com/watch?v=pYm7baUqpew', kind: 'video', note: 'An example of a puppy-safe rest and play area. Adapt the setup to your puppy and home.' },
};

export const careArticles: CareArticle[] = [
  {
    id: 'getting-started', title: 'Your first days with a puppy', category: 'Basics',
    shortTitle: "Your first days", image: 'home',
    glance: [
      {"label": "Potty", "value": "45–60 min", "detail": "Very young puppies while awake; also after waking, meals, and play.", "sources": ["pottyRspca", "potty"]},
      {"label": "Meals", "value": "4 a day", "detail": "A starting point at 8 weeks to 4 months. Divide the daily allowance.", "sources": ["food", "foodKc"]},
      {"label": "Sleep", "value": "18–20 hours", "detail": "Across a whole day, including naps. Make room for quiet rest.", "sources": ["sleep"]},
      {"label": "This week", "value": "Book a vet check", "detail": "Confirm vaccines, parasite care, and safe early introductions.", "sources": ["checklist", "socialVet"]},
    ],
    summary: 'Start here: potty breaks, meals, naps, and a manageable first week.',
    sections: [
      { title: 'Potty: little and often', paragraphs: ['Offer a toilet trip on waking, after food or play, and before bed. Very young puppies may need another trip every 45–60 minutes while awake. Watch their signals and reward them at the toilet spot.'], sources: ['pottyRspca', 'potty'] },
      { title: 'Meals: small and regular', paragraphs: ['Blue Cross suggests four meals daily at 8 weeks to 4 months, three at 4–6 months, then two. Divide the daily food allowance between meals; keep fresh water available. Confirm the plan with your vet, especially for very small puppies.'], sources: ['food', 'foodKc'] },
      { title: 'Sleep: make room for naps', paragraphs: ['Young puppies often sleep around 18–20 hours over a whole day. Provide a quiet resting place and company while they settle into their new home. Expect some overnight toilet trips.'], sources: ['sleep', 'night'] },
      { title: 'This week', paragraphs: ['Arrange a vet check, confirm vaccines and parasite care, and puppy-proof your home. Start brief, gentle, rewarding introductions to everyday life. Ask your vet which places and dogs are safe before vaccinations are complete.'], sources: ['checklist', 'socialVet'] },
    ], related: ['toilet-training', 'feeding', 'sleep-and-first-nights', 'first-vet-visits'],
  },
  {
    id: 'bringing-puppy-home', title: 'Before your puppy comes home', category: 'Basics',
    shortTitle: "Bringing them home", image: 'home',
    glance: [
      {"label": "Their space", "value": "Safe & comfortable", "detail": "Bed, water, and room to move; put hazards out of reach.", "sources": ["checklist", "home"]},
      {"label": "Their food", "value": "Keep it familiar", "detail": "Bring their usual food and ask for the current feeding routine.", "sources": ["home"]},
      {"label": "Their first day", "value": "Keep it calm", "detail": "Stay nearby, introduce a little at a time, and allow plenty of rest.", "sources": ["settle"]},
    ],
    summary: 'A safe space, useful supplies, and a plan for the first day.',
    sections: [
      { title: 'Prepare a small, safe area', paragraphs: ['Choose somewhere easy to clean with a comfortable bed, water, and space to move. Use gates or a pen to limit access to hazards. Put cables, medicines, cleaning products, and small swallowable objects out of reach. Check the garden for escape routes.'], sources: ['checklist', 'home'] },
      { title: 'Have the basics ready', paragraphs: ['Bring home the food your puppy already eats, bowls, bedding, suitable toys, a lead and well-fitting collar or harness, poo bags, and cleaning supplies. Ask for vaccination and worming records, feeding details, and something familiar-smelling if available.'], sources: ['home', 'checklist'] },
      { title: 'Plan for company', paragraphs: ['Keep the first day calm. Introduce a few spaces and people at a time, with opportunities to toilet and rest. Arrange help with meals and toilet trips if you will be away. A safe enclosure does not replace company or gradual alone-time training.'], sources: ['settle', 'alone'] },
    ], related: ['getting-started', 'sleep-and-first-nights', 'time-alone'], videos: ['playDen'],
  },
  {
    id: 'toilet-training', title: 'How often does a puppy need to go out?', category: 'Daily care',
    shortTitle: "Toilet training", image: 'potty',
    glance: [
      {"label": "Very young, while awake", "value": "45–60 min", "detail": "Start with frequent trips; go sooner if you notice their signals.", "sources": ["pottyRspca", "potty"]},
      {"label": "After waking, food, or play", "value": "Take them out", "detail": "Even if the next planned trip is not due.", "sources": ["pottyRspca", "potty"]},
      {"label": "When they get it right", "value": "Reward at the spot", "detail": "Reward immediately after they finish. Never punish accidents.", "sources": ["pottyRspca", "accidents"]},
    ],
    summary: 'Frequent trips, signals to watch for, and what to do about accidents.',
    sections: [
      { title: 'Start with frequent opportunities', paragraphs: ['The RSPCA suggests trips every 45 minutes to an hour, depending on age; Battersea notes that puppies often need hourly trips initially. Dogs Trust offers a broader two-hour routine plus trips after activities. These are starting points, not bladder guarantees. Begin with the shorter interval for a very young puppy and adjust to what actually happens.', 'Go out on waking, after eating or playing, and before bed, even if the next planned trip is not due. Sniffing the floor, circling, restlessness, or heading to the door are reasons to go now.'], sources: ['pottyRspca', 'potty', 'accidents'] },
      { title: 'Help them get it right', paragraphs: ['Use a consistent, safe toilet spot. Stay with your puppy, give them time, and reward them there immediately after they finish. If nothing happens, return indoors, supervise, and try again soon. Do not punish accidents; clean the area thoroughly with a pet-safe enzymatic cleaner.'], sources: ['pottyRspca', 'accidents'] },
      { title: 'Nights and setbacks', paragraphs: ['Some puppies need overnight trips. Keep them quiet and return to bed afterwards. Keep water available rather than restricting it to prevent accidents. Sudden changes, straining, or discomfort need vet advice.', 'Log actual pees and poops in Puptime to spot your puppy’s pattern. A reminder is a prompt to check, not proof they can wait; do not wait for a notification when they show a need.'], sources: ['accidents', 'potty'] },
    ], related: ['feeding', 'sleep-and-first-nights', 'when-to-call-a-vet'], videos: ['zakPotty'],
  },
  {
    id: 'feeding', title: 'How often and how much should a puppy eat?', category: 'Daily care',
    shortTitle: "Meals & water", image: 'feeding',
    glance: [
      {"label": "8 weeks–4 months", "value": "4 meals/day", "detail": "Blue Cross’s starting schedule; confirm what suits your puppy.", "sources": ["food", "foodKc"]},
      {"label": "4–6 months", "value": "3 meals/day", "detail": "The Kennel Club suggests 2–3; ask your vet about the transition.", "sources": ["food", "foodKc"]},
      {"label": "From 6 months", "value": "2 meals/day", "detail": "Divide the daily food allowance. Keep fresh water available.", "sources": ["food", "foodKc"]},
    ],
    summary: 'Meal frequency by age, daily portions, treats, and water.',
    sections: [
      { title: 'A starting point for meal frequency', paragraphs: ['For puppies coming home at about 8 weeks, Blue Cross recommends four meals a day until 4 months, three until 6 months, then two. The Royal Kennel Club gives four meals at 2–3 months, two to three at 4–6 months, then two depending on breed. Ask your vet which transition suits your puppy.', 'Space meals fairly evenly through the day. Very small puppies and puppies with health problems may need a different plan. Keep their existing food initially and introduce a change gradually.'], sources: ['food', 'foodKc', 'care'] },
      { title: 'The daily allowance is not a per-meal allowance', paragraphs: ['Choose a complete puppy food suitable for their expected adult size. Read whether the packet’s guide uses current weight or expected adult weight. Measure the daily amount, then divide it between meals. The label is a starting point: review growth and body condition with your vet.', 'Count training treats as part of the day’s food. Using some of the measured kibble allowance for training can help. Do not add supplements to a complete diet unless your vet recommends them. Large-breed puppies need particular attention to growth nutrition.'], sources: ['foodKc', 'diet', 'food'] },
      { title: 'Water and meal habits', paragraphs: ['Provide fresh water throughout the day and night. Offer food somewhere calm and avoid strenuous exercise close to meals. Record meal times and appetite changes; if your puppy seems unwell or stops eating, ask your vet rather than simply changing the schedule.'], sources: ['food', 'accidents', 'foodKc'] },
    ], related: ['toilet-training', 'exercise-and-play', 'first-vet-visits'],
  },
  {
    id: 'sleep-and-first-nights', title: 'Naps, bedtime, and the first few nights', category: 'Daily care',
    shortTitle: "Sleep & nights", image: 'sleep',
    glance: [
      {"label": "Young puppies", "value": "18–20 hours/day", "detail": "An approximate daily total, including naps; not a quota to force.", "sources": ["sleep"]},
      {"label": "The first nights", "value": "Stay nearby", "detail": "Company helps them settle. Increase distance gradually.", "sources": ["night", "settle"]},
      {"label": "If they wake", "value": "Check their needs", "detail": "A calm toilet trip may be needed; do not leave prolonged distress.", "sources": ["night", "settle"]},
    ],
    summary: 'Lots of sleep, a calm resting place, and help settling at night.',
    sections: [
      { title: 'Expect a lot of sleep', paragraphs: ['The American Kennel Club describes around 18–20 hours of sleep per day for young puppies, including naps. This is a broad expectation, not a quota to force. Give them frequent chances to rest undisturbed between short periods of play, eating, training, and toileting.', 'An overtired puppy may get busier or mouthier. More exercise is not always the answer. Try a quieter environment and an opportunity to settle.'], sources: ['sleep', 'bite'] },
      { title: 'Stay nearby while they settle', paragraphs: ['Your puppy has just left familiar people or littermates. Blue Cross and Dogs Trust advise being nearby at first. Put their bed near yours or temporarily sleep near their resting area, then increase distance gradually if that suits your household.', 'Offer a toilet trip before bed. If they wake and need to go, make it a calm trip and settle them again. Check distress and practical needs rather than leaving them to cry for long periods.'], sources: ['night', 'settle'] },
      { title: 'A crate is optional', paragraphs: ['A bed, pen, or puppy-proofed area can work. If you choose a crate, introduce it gradually with positive experiences; do not immediately shut an unfamiliar puppy inside overnight. It should be a resting place, never a punishment.'], sources: ['settle', 'biteBlue'] },
    ], related: ['toilet-training', 'time-alone', 'biting-and-chewing'], videos: ['playDen'],
  },
  {
    id: 'exercise-and-play', title: 'Exercise, walks, and play without overdoing it', category: 'Daily care',
    shortTitle: "Walks & play", image: 'play',
    glance: [
      {"label": "While growing", "value": "Gentle activity", "detail": "Short walks, sniffing, play, and training at their pace, with rest.", "sources": ["exercise"]},
      {"label": "Avoid rigid formulas", "value": "No fixed minute rule", "detail": "The five-minutes-per-month rule is not a proven scientific limit.", "sources": ["exercise"]},
      {"label": "Before public walks", "value": "Ask your vet", "detail": "Confirm safe places locally while vaccinations are incomplete.", "sources": ["socialVet", "vaccines"]},
    ],
    summary: 'Gentle exploration and rest, with advice tailored to your puppy.',
    sections: [
      { title: 'Quality matters more than a stopwatch', paragraphs: ['PDSA recommends a balance of play, short walks, and training while puppies develop. Choose low-impact activity at their pace, with time to sniff and rest. Avoid forced runs, repeated jumping, and skidding, especially while joints are growing.', 'The familiar “five minutes per month of age” rule is not a proven scientific limit. PDSA explicitly notes that it is not appropriate for most puppies. Age, breed, size, health, and the activity itself matter; ask your vet for individual guidance.'], sources: ['exercise'] },
      { title: 'Exercise before vaccinations are complete', paragraphs: ['Ask your vet which outdoor areas are safe locally. Home play and safe, controlled exposure to everyday sights and sounds can begin while you wait for clearance for public walks. Avoid dog parks and places used by dogs with unknown vaccination status.'], sources: ['socialVet', 'vaccines'] },
      { title: 'Give the brain something to do', paragraphs: ['Short reward-based training, sniffing games, and suitable food puzzles offer variety. Use food from the day’s allowance, supervise toys and chews, and leave room for naps. Stop and seek advice if movement seems painful or your puppy becomes unusually tired.'], sources: ['diet', 'exercise'] },
    ], related: ['socialisation', 'sleep-and-first-nights', 'training-basics'],
  },
  {
    id: 'socialisation', title: 'Socialisation: safe, positive introductions', category: 'Training',
    shortTitle: "Socialisation", image: 'social',
    glance: [
      {"label": "Start early", "value": "Safe introductions", "detail": "The first three months are especially important for learning.", "sources": ["socialVet"]},
      {"label": "Keep it comfortable", "value": "Observe & reward", "detail": "Give them space. Do not force greetings or overwhelming encounters.", "sources": ["socialVet", "social"]},
      {"label": "Before full vaccination", "value": "Check local risks", "detail": "Ask your vet about safe outings, known dogs, and suitable classes.", "sources": ["socialVet", "vaccines"]},
    ],
    summary: 'Introduce the world gently, including before all vaccinations are finished.',
    sections: [
      { title: 'Start early, keep it comfortable', paragraphs: ['AVSAB identifies the first three months as an especially important socialisation period. Socialisation means building comfortable responses to people, animals, handling, sounds, surfaces, and environments. It does not mean greeting every dog or tolerating overwhelming situations.', 'Let your puppy observe at a distance, pair new experiences with things they enjoy, and keep encounters short. If they freeze, hide, try to escape, or seem overwhelmed, give them space and make the experience easier. Avoid forcing contact.'], sources: ['socialVet', 'social', 'socialKc'] },
      { title: 'Balance infection risk with early learning', paragraphs: ['AVSAB supports safe socialisation before full vaccination, while avoiding higher-risk places such as dog parks. Ask your vet about local disease risks, safe carried outings, and contact with known healthy, vaccinated dogs.', 'AVSAB says well-run classes may begin at 7–8 weeks with at least one vaccine set given at least seven days before class and an initial deworming. This is not automatic clearance: your vet and class provider must agree that their requirements and your puppy’s health make attendance appropriate.'], sources: ['socialVet', 'vaccines'] },
      { title: 'Keep building confidence', paragraphs: ['Introduce household sounds, gentle visitors, car travel, and handling a little at a time. Good classes use rewards and let puppies take breaks. Continue positive introductions as your puppy grows rather than trying to finish a checklist in a single week.'], sources: ['social', 'socialKc'] },
    ], related: ['first-vet-visits', 'training-basics', 'handling-and-grooming'], videos: ['kikoSocial'],
  },
  {
    id: 'training-basics', title: 'What to teach first', category: 'Training',
    shortTitle: "Training basics", image: 'training',
    glance: [
      {"label": "How to teach", "value": "Reward what you like", "detail": "Use food, play, or attention they enjoy. Avoid frightening corrections.", "sources": ["trainingVet", "education"]},
      {"label": "How to practise", "value": "Brief & easy", "detail": "Short sessions, few distractions, and one small success at a time.", "sources": ["education", "bite"]},
      {"label": "Useful first skills", "value": "Name, recall & settle", "detail": "Build everyday skills and comfortable handling gradually.", "sources": ["education"]},
    ],
    summary: 'Useful everyday skills, rewards, and choosing a trainer.',
    sections: [
      { title: 'Reward the behaviours you want', paragraphs: ['AVSAB recommends reward-based methods for training and behaviour concerns. Reward a response you like with food, play, or attention your puppy enjoys. Avoid frightening or painful corrections; these can harm welfare and your relationship.', 'Practise in short, easy sessions. If your puppy keeps struggling, reduce distractions or make the task simpler. Hunger, tiredness, worry, and needing the toilet can get in the way of learning.'], sources: ['trainingVet', 'education', 'bite'] },
      { title: 'Prioritise everyday skills', paragraphs: ['Start with responding to their name, coming when called in a safe area, settling, gentle handling, and walking comfortably with a lead. Prevent access to hazards while you teach alternatives. Use the same cues and expectations across the household.', 'Choose one small success at a time and finish while your puppy is still comfortable. Some of their measured meal allowance can serve as training rewards.'], sources: ['education', 'diet'] },
      { title: 'Get help that fits your puppy', paragraphs: ['Ask a prospective trainer what they will do if your puppy is afraid or gets something wrong. Look for reward-based teaching and opportunities to pause. Persistent fear, distress, or aggression needs a vet assessment and qualified behaviour support, rather than trying increasingly forceful methods.'], sources: ['trainingVet', 'separation'] },
    ], related: ['socialisation', 'biting-and-chewing', 'time-alone'], videos: ['kikoBasics'],
  },
  {
    id: 'biting-and-chewing', title: 'Biting, mouthing, and chewing', category: 'Training',
    shortTitle: "Biting & chewing", image: 'chewing',
    glance: [
      {"label": "Have an alternative", "value": "Offer a toy", "detail": "Keep suitable toys nearby and supervise chewing.", "sources": ["bite", "biteBlue"]},
      {"label": "Teeth on skin", "value": "Pause & redirect", "detail": "Stay calm. Avoid shouting, punishment, or exciting squeals.", "sources": ["bite", "biteBlue"]},
      {"label": "If biting increases", "value": "Check for tiredness", "detail": "Offer rest, calm activities, and help with unmet needs.", "sources": ["bite", "biteBlue"]},
    ],
    summary: 'Normal puppy behaviour, safe alternatives, and when to get help.',
    sections: [
      { title: 'Prepare for sharp little teeth', paragraphs: ['Mouthing is common as puppies explore and play. Keep age-appropriate toys nearby and offer one before hands or clothing become the game. Supervise chews and remove damaged toys. Put tempting household objects out of reach.'], sources: ['bite', 'biteBlue'] },
      { title: 'Pause, redirect, and check their needs', paragraphs: ['If teeth touch skin, stay calm, pause the interaction, and redirect when there is a brief break. If necessary, step behind a gate briefly to create space, then return with a suitable activity. Avoid shouting, physical punishment, and exciting squeals.', 'Notice when biting increases: after exciting play, when tired, or when a need has been missed. Offer rest and calmer activities as well as safe chewing. Keep the household’s response consistent.'], sources: ['bite', 'biteBlue'] },
      { title: 'Children and persistent problems', paragraphs: ['Adults should supervise interactions and use barriers when needed; children should not be expected to manage puppy biting themselves. If biting causes injury, appears fearful or aggressive, or worries you, contact your vet and a qualified behaviour professional.'], sources: ['biteBlue', 'bite'] },
    ], related: ['sleep-and-first-nights', 'training-basics', 'handling-and-grooming'],
  },
  {
    id: 'time-alone', title: 'Learning to spend time alone', category: 'Training',
    shortTitle: "Time alone", image: 'alone',
    glance: [
      {"label": "A first step", "value": "Start with seconds", "detail": "Return before they become worried; build up only when comfortable.", "sources": ["alone", "separation"]},
      {"label": "Watch their response", "value": "Keep it easy", "detail": "Pacing, repeated barking, or trying to escape can signal distress.", "sources": ["separation"]},
      {"label": "Longer absences", "value": "Arrange company", "detail": "Get help when time away exceeds what your puppy can manage.", "sources": ["alone", "separation"]},
    ],
    summary: 'Build comfort gradually and arrange help for longer absences.',
    sections: [
      { title: 'Teach a feeling of safety', paragraphs: ['Being alone is a skill to introduce gradually. First help your puppy feel comfortable resting while you are nearby. Then try very brief separations and return before they become worried. Increase time only when the previous step is easy; a few seconds may be the right starting point.', 'There is no age formula that guarantees emotional comfort. A puppy who can wait between toilet trips may still struggle with separation.'], sources: ['alone', 'separation'] },
      { title: 'Watch what happens', paragraphs: ['Use a safe resting area and meet food, water, toilet, and companionship needs first. Where possible, observe or record brief absences. Pacing, repeated barking, panting, or trying to escape can signal distress. Make the next practice easier rather than leaving them longer to get used to it.'], sources: ['separation', 'alone'] },
      { title: 'Plan around their current ability', paragraphs: ['Arrange a trusted person to help when an absence exceeds what your puppy can currently manage. Crates and food toys do not treat separation anxiety on their own. If distress persists, speak to your vet and seek a qualified professional who uses positive methods.'], sources: ['alone', 'separation'] },
    ], related: ['sleep-and-first-nights', 'bringing-puppy-home', 'training-basics'],
  },
  {
    id: 'handling-and-grooming', title: 'Handling, grooming, and teeth', category: 'Health',
    shortTitle: "Grooming & teeth", image: 'grooming',
    glance: [
      {"label": "Handling", "value": "Small, rewarding steps", "detail": "Practise brief touches. Let them move away and build gradually.", "sources": ["education", "social"]},
      {"label": "Healthy teeth", "value": "Brush daily", "detail": "Build up gently using dog toothpaste, never human toothpaste.", "sources": ["dental"]},
      {"label": "Coat, nails & ears", "value": "Tailor their care", "detail": "Ask a vet or suitable groomer about their individual needs.", "sources": ["healthcare", "dental"]},
    ],
    summary: 'Make everyday care comfortable with small, rewarding steps.',
    sections: [
      { title: 'Introduce handling gently', paragraphs: ['Practise brief touches to paws, ears, and the area around the mouth, paired with a reward. Let your puppy move away and build up gradually. Introduce brushes and other equipment before expecting a full grooming session. Stop and make the step easier if they seem worried.'], sources: ['education', 'social'] },
      { title: 'Build a tooth-brushing habit', paragraphs: ['Blue Cross recommends daily tooth brushing as the best way to keep teeth healthy. Begin by helping your puppy accept gentle mouth handling, then use a suitable dog toothbrush and dog toothpaste. Do not use human toothpaste. Ask your vet to demonstrate if you are unsure.'], sources: ['dental'] },
      { title: 'Match care to their coat and health', paragraphs: ['Grooming needs vary by coat. Ask your vet or a suitable groomer how often to brush and how to manage nails and ears. Introduce visits positively. Pain, bleeding, an unpleasant smell, or persistent irritation needs a vet check rather than more forceful handling.'], sources: ['healthcare', 'dental'] },
    ], related: ['training-basics', 'socialisation', 'first-vet-visits'],
  },
  {
    id: 'first-vet-visits', title: 'First vet visits and preventive care', category: 'Health',
    shortTitle: "First vet visits", image: 'vet',
    glance: [
      {"label": "Before the visit", "value": "Bring their records", "detail": "Vaccinations, worming, health details, and their current food.", "sources": ["care", "healthcare", "checklist"]},
      {"label": "Make a plan", "value": "Vaccines & parasites", "detail": "Timing, products, and doses depend on your puppy and location.", "sources": ["healthcare", "vaccines"]},
      {"label": "Questions to ask", "value": "When are outings safe?", "detail": "Confirm public walks, controlled introductions, and class requirements.", "sources": ["vaccines", "socialVet"]},
    ],
    summary: 'Vaccination records, parasites, growth checks, and questions to ask.',
    sections: [
      { title: 'Bring the records you have', paragraphs: ['Arrange an early check and bring the breeder’s or rescue’s vaccination, worming, and health records. Discuss your puppy’s diet, growth, toileting, and any symptoms. Ask about a parasite-prevention plan appropriate to their age, weight, and location; do not guess a dose.'], sources: ['care', 'healthcare', 'checklist'] },
      { title: 'Get an individual vaccination plan', paragraphs: ['Vaccines and the timing of protection depend on the products used, previous doses, and local risks. PDSA’s UK guidance describes a course starting in puppyhood with follow-up doses; it should not be treated as a universal timetable for every country or puppy.', 'Ask: Which doses are still due? When are public walks safe? Which controlled socialisation opportunities are appropriate now? What are the requirements for puppy classes? Keep follow-up dates somewhere you will see them.'], sources: ['vaccines', 'socialVet'] },
      { title: 'Keep up with growth and identification', paragraphs: ['Review body condition and food portions as your puppy grows. Discuss microchipping, contact details, and any local identification requirements. Save your regular vet’s number and their out-of-hours service before you need them.'], sources: ['foodKc', 'healthcare', 'firstAid'] },
    ], related: ['feeding', 'socialisation', 'when-to-call-a-vet'],
  },
  {
    id: 'when-to-call-a-vet', title: 'When to call a vet', category: 'Health',
    shortTitle: "When to call a vet", image: 'urgent',
    glance: [
      {"label": "Emergency signs", "value": "Call immediately", "detail": "Trouble breathing, collapse, inability to pee, or suspected poisoning. These are examples, not a complete list.", "sources": ["firstAid", "poison"]},
      {"label": "Young puppy unwell", "value": "Get prompt advice", "detail": "Vomiting, diarrhoea, refusing food, or unusual behaviour need a vet call.", "sources": ["vomiting", "sickPuppy"]},
      {"label": "Suspected poisoning", "value": "Do not induce vomiting", "detail": "Call a vet immediately and keep packaging or details of what they ate.", "sources": ["poison"]},
    ],
    summary: 'Recognise urgent problems and use your logs to describe a change.',
    sections: [
      { title: 'Get urgent help', paragraphs: ['Contact a vet or emergency clinic immediately for trouble breathing, collapse, inability to pee, a seizure, serious bleeding, or suspected poisoning. A swollen painful abdomen with repeated retching is also an emergency. These examples are not a complete list; call if you are worried.'], sources: ['firstAid', 'vomiting', 'poison'] },
      { title: 'Do not wait for a routine to explain illness', paragraphs: ['Vomiting with low energy, blood, pain, or signs of dehydration needs prompt advice. With a young puppy, contact your vet promptly about vomiting, diarrhoea, refusing food, or an unusual change in behaviour rather than applying an adult dog’s “wait and see” advice.', 'If they may have swallowed a harmful food, medicine, plant, or object, call immediately. Do not induce vomiting unless a vet tells you to. Keep packaging or details of what and when they ate it.'], sources: ['vomiting', 'sickPuppy', 'poison'] },
      { title: 'Your log can help the conversation', paragraphs: ['Have meal, pee, and poop times and your notes ready when you call. Describe what changed and how your puppy seems now. Puptime’s patterns and reminders cannot diagnose illness or rule out a problem.'], sources: ['firstAid'] },
    ], related: ['first-vet-visits', 'feeding', 'toilet-training'],
  },
];

export function findCareArticles(query: string): CareArticle[] {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return careArticles.filter((article) => {
    const text = [article.title, article.shortTitle, article.summary, article.category, ...article.glance.flatMap((item) => [item.label, item.value, item.detail]), ...article.sections.flatMap((section) => [section.title, ...section.paragraphs])].join(' ').toLowerCase();
    return words.every((word) => text.includes(word));
  });
}
