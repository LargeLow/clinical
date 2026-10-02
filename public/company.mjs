export const companyContext = 'tanner-davis-v1';
export const profileKeys = ['territory','clinics','indications','investigators','studyPreferences','workingPreferences'];
export const defaultProfile = () => ({territory:'Davis County, Utah',clinics:'Tanner Clinic — Davis County locations',indications:'',investigators:'',studyPreferences:'',workingPreferences:''});
export const davisCities = ['Bountiful','Centerville','Clearfield','Clinton','Farmington','Fruit Heights','Kaysville','Layton','North Salt Lake','South Weber','Sunset','Syracuse','West Bountiful','West Point','Woods Cross'];
export function isDavisLocation(location) {
  return location.country==='United States' && location.state==='Utah' && davisCities.some(city=>city.toLowerCase()===location.city?.trim().toLowerCase());
}
export function prioritizeDavisSites(study) {
  const p=study.protocolSection;
  if(!p?.contactsLocationsModule?.locations)return study;
  return {...study,protocolSection:{...p,contactsLocationsModule:{...p.contactsLocationsModule,locations:[...p.contactsLocationsModule.locations].sort((a,b)=>Number(isDavisLocation(b))-Number(isDavisLocation(a)))}}};
}
export const baseline = {
  researched:'2026-10-01', company:'Tanner Clinic', territory:'Davis County, Utah',
  sources:{locations:'https://tannerclinic.com/locations/',research:'https://tannerclinic.com/clinical-trials/',providers:'https://tannerclinic.com/provider/',cities:'https://www.daviscountyutah.gov/county-info/cities'},
  locations:[
    {name:'East Layton',city:'Layton',address:'1750 East 3100 North',specialties:['family medicine','orthopedics','behavioral health','pediatrics','sports medicine','interventional spine and pain']},
    {name:'Farmington',city:'Farmington',address:'444 W Bourne Circle Suite 101',specialties:['family medicine']},
    {name:'Kaysville',city:'Kaysville',address:'380 North 400 West',specialties:['family medicine','podiatry','pediatrics','dermatology']},
    {name:'Layton Antelope A',city:'Layton',address:'2121 North 1700 West',specialties:['family medicine','pediatrics','ENT','internal medicine','orthopedics']},
    {name:'Layton Antelope B',city:'Layton',address:'1756 Antelope Drive',specialties:['general surgery','OB/GYN','ophthalmology','urology','optometry','interventional spine and pain']},
    {name:'Layton Parkway',city:'Layton',address:'425 S 100 W',specialties:['allergy/asthma/immunology','dermatology','ENT','endocrinology','family medicine','internal medicine','OB/GYN','orthopedics','pediatrics','podiatry']},
    {name:'Robert F. Bitner Medical Building',city:'Layton',address:'2132 N 1700 W Suites 220 & 310',specialties:['gastroenterology through Utah Digestive Health','OB/GYN']},
    {name:'Syracuse',city:'Syracuse',address:'2038 West 1900 South',specialties:['family medicine','internal medicine','nephrology','pediatrics']},
    {name:'Westside',city:'Clinton',address:'1477 North 2000 West',specialties:['family medicine','pediatrics','behavioral health']}
  ],
  researchAreas:['dermatology: psoriasis, atopic dermatitis, prurigo nodularis','chronic spontaneous urticaria','rheumatoid arthritis specimen collection','cancer-history genomic specimen collection','pediatric vaccines'],
  researchContacts:[{name:'Marissa Reynolds',phone:'801-773-4840',extension:'2232'},{name:'Carly Stachwick',phone:'801-773-4840',extension:'3639'},{name:'Raelee Giles',phone:'801-773-4840',extension:'3836'}],
  registryHistory:[{id:'NCT03239873',sponsor:'Merck Sharp & Dohme LLC',source:'https://clinicaltrials.gov/study/NCT03239873'},{id:'NCT05049655',sponsor:'ByHeart',source:'https://clinicaltrials.gov/study/NCT05049655'}],
  caveats:'Published services are not confirmed research capacity. Website trial listings require availability verification. Research contacts are not confirmed sponsor/CRO business development contacts. Registry history does not prove current contracts or site openings. Roy and South Ogden are outside the default territory; Murray is listed as closed. Utah Digestive Health is a published service relationship, not proof of legal ownership. No other affiliated companies are confirmed.'
};

// Preserve old context for review, but do not send it as confirmed Tanner preferences.
export function migrateWorkspace(data) {
  if(data.companyContext===companyContext)return data;
  return {...data,companyContext,legacyContext:data.legacyContext||{company:'Previous Nira setup',profile:data.profile||{},onboarding:data.onboarding||{}},profile:defaultProfile(),onboarding:{answers:{},step:0,completed:false}};
}
