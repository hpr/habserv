export const USE_CACHE = false; // breaks if true
export const MAX_CONTEXT_LENGTH = 48000;
export const POST_PROMPT = `Please predict the final places and times of the athletes. List the athletes in order of finish with their predicted times (don't just copy their personal best, predict a new time). Then, explain why you think they will finish in that order. In your reasoning, use the info from the Wikipeida bios and compare athletes with each other using the results, and don't be afraid to make harsh judgements based on the data. Make reference to specific standout results for the athletes in your reasoning, whether good or bad.`;
export const P_WA_ATHLETE_ID = "P1146";

export const GRAPHQL_ENDPOINT = 'https://graphql-prod-4746.prod.aws.worldathletics.org/graphql';
export const GRAPHQL_API_KEY = 'da2-lkoax6kydng4pglnfp2ytqmrte'; // intentionally public

export const GetCompetitorBasicInfo = `
query GetCompetitorBasicInfo($id: Int, $urlSlug: String) {
  competitor: getSingleCompetitor(id: $id, urlSlug: $urlSlug) {
    basicData {
      givenName familyName birthDate iaafId aaId countryCode
    }
    personalBests {
      results {
        indoor discipline mark notLegal venue date resultScore
      }
    }
    resultsByYear {
      activeYears
      resultsByEvent {
        indoor discipline
        results { date venue place mark wind notLegal }
      }
    }
  }
}`;
export const GetSingleCompetitorResultsDate = `
query GetSingleCompetitorResultsDate($id: Int, $resultsByYearOrderBy: String, $resultsByYear: Int) {
  getSingleCompetitorResultsDate(id: $id, resultsByYear: $resultsByYear, resultsByYearOrderBy: $resultsByYearOrderBy) {
    parameters { resultsByYear }
    activeYears
    resultsByDate {
      date
      competition
      venue
      indoor
      disciplineCode
      disciplineNameUrlSlug
      typeNameUrlSlug
      discipline
      country
      category
      race
      place
      mark
      wind
      notLegal
      resultScore
      remark
      __typename
    }
    __typename
  }
}`;
export const disciplines = [
  "50 Metres",
  "55 Metres",
  "60 Metres",
  "100 Metres",
  "100 Yards",
  "150 Metres",
  "200 Metres",
  "300 Metres",
  "400 Metres",
  "500 Metres",
  "600 Metres",
  "800 Metres",
  "1000 Metres",
  "1500 Metres",
  "One Mile",
  "Mile",
  "2000 Metres",
  "3000 Metres",
  "Two Miles",
  "5000 Metres",
  "5 Kilometres",
  "8 Kilometres",
  "5 Miles Road",
  "10,000 Metres",
  "10 Kilometres",
  "12 Kilometres",
  "15,000 Metres",
  "15 Kilometres",
  "One Mile Road",
  "10 Miles Road",
  "20,000 Metres",
  "20 Kilometres",
  "One Hour",
  "Half Marathon",
  "25,000 Metres",
  "25 Kilometres",
  "30,000 Metres",
  "30 Kilometres",
  "Marathon",
  "50 Kilometres",
  "100 Kilometres",
  "24 Hours",
  "2000 Metres Steeplechase",
  "2000 Metres Steeplechase (84)",
  "3000 Metres Steeplechase",
  "50 Metres Hurdles",
  "55 Metres Hurdles",
  "60 Metres Hurdles",
  "60m Hurdles (91.4cm)",
  "60m Hurdles (99.0cm)",
  "60m Hurdles (76.2cm)",
  "80 Metres Hurdles",
  "100 Metres Hurdles",
  "110m Hurdles (99.0cm)",
  "100m Hurdles (76.2cm)",
  "110 Metres Hurdles",
  "110m Hurdles (91.4cm)",
  "200 Metres Hurdles",
  "300m Hurdles (84.0cm)",
  "300 Metres Hurdles",
  "400m hurdles (84.0cm)",
  "400 Metres Hurdles",
  "High Jump",
  "Pole Vault",
  "Long Jump",
  "Triple Jump",
  "Shot Put",
  "Shot Put (6kg)",
  "Shot Put (5kg)",
  "Shot Put (3kg)",
  "Shot Put (4kg)",
  "Discus Throw",
  "Discus Throw (1.750kg)",
  "Discus Throw (1.500kg)",
  "Hammer Throw",
  "Hammer Throw (6kg)",
  "Hammer Throw (5kg)",
  "Hammer Throw (3kg)",
  "Javelin Throw",
  "Javelin Throw (old)",
  "Javelin Throw (700g)",
  "Javelin Throw (500g)",
  "Pentathlon",
  "Pentathlon Girls",
  "Heptathlon",
  "Heptathlon U20",
  "Heptathlon-100mH 76.2cm",
  "Heptathlon Girls",
  "Heptathlon Boys",
  "Octathlon Boys",
  "Decathlon",
  "Decathlon (62-84)",
  "Decathlon U20",
  "Decathlon Boys",
  "One Mile Race Walk",
  "3000 Metres Race Walk",
  "5000 Metres Race Walk",
  "5 Kilometres Race Walk",
  "10,000 Metres Race Walk",
  "10 Kilometres Race Walk",
  "15 Kilometers Race Walk",
  "20,000 Metres Race Walk",
  "20 Kilometres Race Walk",
  "2 Hours Race Walk",
  "30,000 Metres Race Walk",
  "30 Kilometres Race Walk",
  "35 Kilometres Race Walk",
  "50,000 Metres Race Walk",
  "35,000 Metres Race Walk",
  "50 Kilometres Race Walk",
  "4x100 Metres Relay",
  "4x200 Metres Relay",
  "4x400 Metres Relay",
  "4x400 Metres Relay Mixed",
  "Mixed 2x2x400m Relay",
  "Shuttle Hurdles Relay",
  "4x800 Metres Relay",
  "4x1500 Metres Relay",
  "Medley Relay",
  "8x100 Metres Relay",
  "Road Relay",
  "Distance Medley Relay",
  "Mixed Relay",
  "One Hour Walk",
  "Senior Race",
  "Cross Country",
  "U20 Race",
  "U23 Race",
  "Short Race",
  "Long Race",
  "20libs Weight",
  "35libs Weight",
  "Cross Country 4000m",
  "100m Blind",
  "200m Blind",
  "400m Blind",
  "100m Wheelchair",
  "200m Wheelchair",
  "1500m Wheelchair",
  "800m Wheelchair",
  "Javelin Throw Wheelchair",
  "200m Amputee",
  "100m Amputee",
  "400m Cereb. Palsy",
  "200m Visually Impaired",
  "400 Metres T53",
  "800 Metres T54",
  "400m Masters",
  "800m Masters",
];
export const fieldDisciplines = [
  "High Jump",
  "Long Jump",
  "Pole Vault",
  "Triple Jump",
  "Shot Put",
  "Discus Throw",
  "Javelin Throw",
  "Hammer Throw",
  "Decathlon",
  "Heptathlon",
];
