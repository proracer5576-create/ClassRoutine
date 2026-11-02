import assert from "node:assert/strict";
import test from "node:test";
import { loadDailyInfo, mealWarnings, normalizeAllergenCodes, outdoorGuidance, parseMealDishes, sanitizeIntegrationSettings, searchSchools } from "../daily-info.mjs";

test("meal allergen codes are parsed and matched without sending roster data", async () => {
  const dishes = parseMealDishes("현미밥<br/>달걀찜(1.2.)<br/>두부조림(5.6.)");
  assert.deepEqual(dishes, [
    { name:"현미밥", allergenCodes:[] },
    { name:"달걀찜", allergenCodes:["1","2"] },
    { name:"두부조림", allergenCodes:["5","6"] }
  ]);
  assert.deepEqual(normalizeAllergenCodes("2|6|99|2"), ["2","6"]);
  assert.deepEqual(mealWarnings({ dishes }, [{ number:"3", name:"김학생", allergenCodes:["2"] }])[0].dishes[0].matchedNames, ["우유"]);

  const requested = [];
  const fetchFn = async url => {
    requested.push(String(url));
    return { ok:true, json:async () => ({ mealServiceDietInfo:[{}, { row:[{ MMEAL_SC_CODE:"2", MMEAL_SC_NM:"중식", MLSV_YMD:"20260904", DDISH_NM:"달걀찜(1.2.)", CAL_INFO:"500 Kcal" }] }] }) };
  };
  const data = await loadDailyInfo({ neisApiKey:"private-key", neisOfficeCode:"B10", neisSchoolCode:"1234567" }, { now:new Date("2026-09-04T03:00:00Z"), fetchFn, force:true });
  assert.equal(data.meal.status, "ready");
  assert.equal(data.weather.status, "unconfigured");
  assert.equal(requested.length, 1);
  assert.doesNotMatch(requested[0], /김학생|allergen/i);
});

test("outdoor guidance applies conservative local rules", () => {
  assert.equal(outdoorGuidance({ temperature:24, precipitationProbability:10, windSpeed:2, precipitationType:0 }).level, "good");
  assert.equal(outdoorGuidance({ temperature:31, precipitationProbability:10, windSpeed:2, precipitationType:0 }).level, "caution");
  assert.equal(outdoorGuidance({ temperature:24, precipitationProbability:70, windSpeed:2, precipitationType:0 }).level, "indoor");
  assert.equal(outdoorGuidance({ temperature:24, precipitationProbability:10, windSpeed:2, precipitationType:1 }).level, "indoor");
});

test("integration settings preserve saved keys when password fields are blank", () => {
  const previous = { neisApiKey:"keep-neis", kmaApiKey:"keep-kma", neisOfficeCode:"B10", neisSchoolCode:"123" };
  const next = sanitizeIntegrationSettings({ neisOfficeCode:"c10", neisApiKey:"", kmaApiKey:"", weatherNx:"60", weatherNy:"127" }, previous);
  assert.equal(next.neisApiKey, "keep-neis");
  assert.equal(next.kmaApiKey, "keep-kma");
  assert.equal(next.neisOfficeCode, "C10");
  assert.equal(next.weatherNx, "60");
});

test("school name search returns safe selectable NEIS codes", async () => {
  let requested = "";
  const fetchFn = async url => {
    requested = String(url);
    return { ok:true, json:async () => ({ schoolInfo:[{}, { row:[{
      ATPT_OFCDC_SC_CODE:"J10", ATPT_OFCDC_SC_NM:"경기도교육청", SD_SCHUL_CODE:"7530001",
      SCHUL_NM:"한빛초등학교", SCHUL_KND_SC_NM:"초등학교", ORG_RDNMA:"경기도 한빛시 배움로 1"
    }] }] }) };
  };
  const result = await searchSchools({ neisApiKey:"private-key" }, "한빛초등학교", { fetchFn });
  assert.equal(result.status, "ready");
  assert.deepEqual(result.schools[0], { officeCode:"J10", officeName:"경기도교육청", schoolCode:"7530001", schoolName:"한빛초등학교", schoolType:"초등학교", address:"경기도 한빛시 배움로 1" });
  assert.match(requested, /\/hub\/schoolInfo\?/);
  assert.match(requested, /SCHUL_NM=/);
  assert.equal("neisApiKey" in result.schools[0], false);
  assert.equal((await searchSchools({}, "한빛초등학교", { fetchFn })).status, "unconfigured");
});
