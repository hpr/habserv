import { JSDOM } from 'jsdom';
import { GetCompetitorBasicInfo, GetSingleCompetitorResultsDate } from './const';

export const getAge = (birthday, year = String(new Date().getFullYear())) => {
  const ageDifMs = +(new Date(year)) - birthday.getTime();
  const ageDate = new Date(ageDifMs);
  return Math.abs(ageDate.getUTCFullYear() - 1970);
};

export const nth = (n) => {
  return n + (["st", "nd", "rd"][((((n + 90) % 100) - 10) % 10) - 1] || "th");
};

export const getWaApi = async (): Promise<{ endpoint: string, apiKey: string } | undefined> => {
  const { window } = new JSDOM(await (await fetch(`https://worldathletics.org/athletes`)).text());
  const graphqlSrcs = [...window.document.querySelectorAll('script[src]')]
    .filter((script) => script.getAttribute('src')?.match(/\/_next\/static\/chunks\/[a-z0-9]{40}\.[a-z0-9]{20}\.js/)).map(s => s.getAttribute('src'));
  let endpoint = '';
  let apiKey = '';
  for (const graphqlSrc of graphqlSrcs) {
    const graphqlJs = await (await fetch(`https://worldathletics.org${graphqlSrc}`)).text();
    const obj = JSON.parse(graphqlJs.match(/graphql:({.*?})/)?.[1].replace(/\s*(['"])?([a-z0-9A-Z_\.]+)(['"])?\s*:([^,\}]+)(,)?/g, '"$2": $4$5') ?? '{}');
    if (obj.endpoint && obj.apiKey) {
      endpoint = obj.endpoint;
      apiKey = obj.apiKey;
      break;
    }
  }
  if (!endpoint || !apiKey) return;
  return { endpoint, apiKey };
}

export const getBasicInfo = async (id: string, endpoint: string, apiKey: string, attempts = 0) => {
  if (attempts) console.log('getBasicInfo attempt #', id, attempts);
  if (attempts > 10) throw new Error();
  try {
    const basicInfo = (
      await (
        await fetch(endpoint, {
          headers: { "x-api-key": apiKey },
          body: JSON.stringify({
            operationName: "GetCompetitorBasicInfo",
            query: GetCompetitorBasicInfo,
            variables: { id },
          }),
          method: "POST",
        })
      ).json()
    ).data.competitor;
    return basicInfo;
  } catch (e) {
    return await getBasicInfo(id, endpoint, apiKey, attempts + 1);
  }
}

export const getYearCompetitor = async (id: string, year: number, endpoint: string, apiKey: string, attempts = 0) => {
  if (attempts) console.log('getYearCompetitor attempt #', id, year, attempts);
  if (attempts > 10) throw new Error();
  try {
    const yearCompetitor = (
      await (
        await fetch(endpoint, {
          headers: { "x-api-key": apiKey },
          body: JSON.stringify({
            operationName: "GetSingleCompetitorResultsDate",
            query: GetSingleCompetitorResultsDate,
            variables: {
              id,
              resultsByYear: year,
              resultsByYearOrderBy: "date",
            },
          }),
          method: "POST",
        })
      ).json()
    ).data.getSingleCompetitorResultsDate;
    return yearCompetitor;
  } catch (e) {
    return await getYearCompetitor(id, year, endpoint, apiKey, attempts + 1);
  }
}

export const fetchRetry = async (url: string, attempts = 0) => {
  if (attempts) console.log('fetchRetry attempt #', url, attempts);
  if (attempts > 10) throw new Error();
  try {
    return await (await fetch(url)).json();
  } catch (e) {
    return await fetchRetry(url, attempts + 1);
  }
}
