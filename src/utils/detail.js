import lodash from "lodash";
import moment from "moment-timezone";
import pLimit from "p-limit";
import { getAbyDetail, getBase, getCharacters, getIndex } from "#utils/api";
import { getCookie, tryToWarnInvalidCookie } from "#utils/cookie";
import db from "#utils/database";

("use strict");

function detailError(message, cache = false, master = false, message_master = "") {
  return { detail: true, message, cache, master, message_master };
}

function getDetailErrorForPossibleInvalidCookie(retcode, message, cookie) {
  const warnInvalidCookie = tryToWarnInvalidCookie(retcode, cookie);
  const masterArgs = warnInvalidCookie ? [true, warnInvalidCookie] : [false, ""];
  throw detailError(`米游社接口报错: ${message}`, false, ...masterArgs);
}

// return true if we use cache
function parseDetailError(e) {
  const messages = [];

  if (true === e.detail) {
    // 尝试使用缓存
    if (true !== e.cache) {
      if ("string" === typeof e.message) {
        messages.push(e.message);
      }

      if (true === e.master && "string" === typeof e.message_master) {
        messages.push(e.message_master);
      }

      return messages;
    }

    return true;
  }

  return false;
}

function handleDetailError(msg, e) {
  const parsed = parseDetailError(e);

  if (!parsed) {
    msg.bot.sayMaster(msg.sid, e, msg.type, msg.uid);
    return true;
  }

  if (Array.isArray(parsed)) {
    if ("string" === typeof parsed[0]) {
      msg.bot.say(msg.sid, parsed[0], msg.type, msg.uid, true);
    }

    if ("string" === typeof parsed[1]) {
      msg.bot.sayMaster(msg.sid, parsed[1], msg.type, msg.uid);
    }

    if (0 === parsed.length) {
      msg.bot.say(msg.sid, "无法连接米游社，有可能是服务商 IP 已被屏蔽。", msg.type, msg.uid, true);
    }

    return true;
  }

  return false;
}

function userInitialize(uid, nickname, level) {
  if (!db.includes("character", "record", { uid })) {
    db.push("character", "record", { uid, roles: [] });
  }

  if (!db.includes("time", "user", { uid })) {
    db.push("time", "user", { uid, time: 0 });
  }

  if (!db.includes("time", "user", { aby: uid })) {
    db.push("time", "user", { aby: uid, time: 0 });
  }

  if (!db.includes("info", "user", { uid })) {
    const initData = {
      retcode: 19260817,
      message: "init message",
      uid,
      nickname,
      level,
      avatars: [],
      explorations: [],
      stats: {},
    };
    db.push("info", "user", initData);
  }
}

async function abyDetail(uid, server, userID, schedule_type, bot) {
  userInitialize(uid, "", -1);

  const nowTime = new Date().valueOf();
  const { time: lastTime } = db.get("time", "user", { aby: uid }) || {};
  const { data: dbData } = db.get("aby", "user", { uid }) || {};

  // 尝试使用缓存
  if (dbData) {
    // 第 31 期深渊开始的时刻
    const ftime = moment("2021-10-01T04:00:00").tz("Asia/Shanghai");
    // 查询的时刻
    const ntime = moment().tz("Asia/Shanghai");
    // 数据库中的期数
    const { schedule_id: db_schedule } = dbData || {};
    // 查询时的期数
    let this_schedule = 31 + (ntime.year() - ftime.year()) * 12 * 2 + (ntime.month() - ftime.month()) * 2;

    // 如果查询的时刻过了每月的十五号凌晨四点，查询时的期数加一
    if (ntime.date() - ftime.date() + 1 > 15 || (15 === ntime.date() && ntime.hours() >= ftime.hours())) {
      this_schedule++;
    }

    // 如果查询上期深渊，期数减一
    this_schedule -= parseInt(schedule_type) - 1;

    // 如果查询的期数和数据库中的期数一致，尝试使用缓存
    if (
      db_schedule === this_schedule &&
      lastTime &&
      nowTime - lastTime < global.config.cacheAbyEffectTime * 60 * 60 * 1000
    ) {
      bot.logger.debug(`缓存：使用 ${uid} 在 ${global.config.cacheAbyEffectTime} 小时内的深渊记录缓存。`);
      throw detailError("", true);
    }
  }

  let cookie;
  let response;

  try {
    cookie = getCookie(uid, true, bot);
    response = await getAbyDetail(uid, schedule_type, server, cookie);
  } catch (e) {
    throw detailError(e);
  }

  const { retcode, message, data } = response;

  if (0 !== retcode) {
    return getDetailErrorForPossibleInvalidCookie(retcode, message, cookie);
  }

  if (!data || 0 === Object.keys(data).length) {
    throw detailError("没有查询到深渊信息。");
  }

  if (undefined === data.max_floor || "0-0" === data.max_floor) {
    throw detailError("此账号未挑战深境螺旋。");
  }

  if (Array.isArray(data.floors) && 0 === data.floors.length) {
    throw detailError("无渊月螺旋记录。");
  }

  if (!db.includes("aby", "user", { uid })) {
    db.push("aby", "user", { uid, data: {} });
  }

  db.update("aby", "user", { uid }, { data });
  db.update("time", "user", { aby: uid }, { time: nowTime });
  bot.logger.debug(`缓存：新增 ${uid} 的深渊记录，缓存 ${global.config.cacheAbyEffectTime} 小时。`);

  return data;
}

async function baseDetail(mhyID, userID, bot) {
  let cookie;
  let response;

  try {
    cookie = getCookie(undefined, false, bot);
    response = await getBase(mhyID, cookie);
  } catch (e) {
    throw detailError(e);
  }

  const { retcode, message, data } = response;
  const errInfo = "未查询到角色数据，请检查米哈游通行证是否有误或是否设置角色信息公开";

  if (0 !== retcode) {
    return getDetailErrorForPossibleInvalidCookie(retcode, message, cookie);
  }

  if (!Array.isArray(data.list) || 0 === data.list.length) {
    throw detailError(errInfo);
  }

  const baseInfo = data.list.find((el) => 2 === el.game_id);

  if (!baseInfo) {
    throw detailError(errInfo);
  }

  const { game_role_id: roleID, nickname, region, level } = baseInfo;
  const uid = parseInt(roleID);

  userInitialize(uid, nickname, level);
  db.update("info", "user", { uid }, { level, nickname });

  if (db.includes("map", "user", { userID })) {
    const record = db.get("map", "user", { userID }) || {};

    if (mhyID === record.mhyID && uid !== record.UID) {
      db.update("map", "user", { userID }, { UID: uid });
    }
  }

  return [uid, region];
}

async function indexDetail(uid, server, userID, bot) {
  userInitialize(uid, "", -1);

  const nowTime = new Date().valueOf();
  const { time } = db.get("time", "user", { uid }) || {};

  if (time && nowTime - time < global.config.cacheInfoEffectTime * 60 * 60 * 1000) {
    const { retcode } = db.get("info", "user", { uid }) || {};

    if (0 === retcode) {
      const { retcode, message } = db.get("info", "user", { uid }) || {};

      if (0 !== retcode) {
        throw detailError(`米游社接口报错: ${message}`);
      }

      bot.logger.debug(`缓存：使用 ${uid} 在 ${global.config.cacheInfoEffectTime} 小时内的玩家数据缓存。`);
      throw detailError("", true);
    }
  }

  let cookie;
  let response;

  try {
    cookie = getCookie(uid, true, bot);
    response = await getIndex(uid, server, cookie);
  } catch (e) {
    throw detailError(e);
  }

  const { retcode, message, data } = response;

  if (0 !== retcode) {
    db.update("info", "user", { uid }, { message, retcode: parseInt(retcode) });
    return getDetailErrorForPossibleInvalidCookie(retcode, message, cookie);
  }

  if (!Array.isArray(data.avatars) || 0 === data.avatars.length) {
    throw detailError(`请求 API 数据错误，请重试。`);
  }

  db.update(
    "info",
    "user",
    { uid },
    {
      message,
      retcode: parseInt(retcode),
      explorations: data.world_explorations,
      stats: data.stats,
      homes: data.homes,
    }
  );

  db.update("time", "user", { uid }, { time: nowTime });
  bot.logger.debug(`缓存：新增 ${uid} 的玩家数据，缓存 ${global.config.cacheInfoEffectTime} 小时。`);
  return data.avatars.map((el) => el.id);
}

// 适应米游社 API 改版，如果 guess 为 true 则猜测所有除了 character_ids 之外可能的角色。
// https://github.com/Arondight/Adachi-BOT/issues/436
// -----------------------------------------------------------------------------
// API 再次改版， guess 应当总为 false，相关代码仅做留存。
// https://github.com/Arondight/Adachi-BOT/issues/486
async function characterDetail(uid, server, character_ids, guess = false, bot) {
  userInitialize(uid, "", -1);

  let cookie;
  let response;

  try {
    cookie = getCookie(uid, true, bot);
    response = await getCharacters(uid, server, character_ids, cookie);
  } catch (e) {
    throw detailError(e);
  }

  const { retcode, message, data } = response;

  if (0 !== retcode) {
    return getDetailErrorForPossibleInvalidCookie(retcode, message, cookie);
  }

  if (!Array.isArray(data.avatars) || 0 === data.avatars.length) {
    throw detailError(`请求 API 数据错误，请重试。`);
  }

  if (true === guess) {
    const MAX_THREADS_NUM = 6;
    const MAX_QUERY_NUM = 8;
    const limit = pLimit(MAX_THREADS_NUM);
    const { roles: record } = db.get("character", "record", { uid });
    const { stats } = db.get("info", "user", { uid });
    const knownRoles = (record || []).filter((c) => !character_ids.includes(c));
    const knownRoleChunks = lodash.chunk(knownRoles, MAX_QUERY_NUM);
    const roleNumber = (stats || {}).avatar_number;
    let queryList = knownRoleChunks;
    let promises;

    if (roleNumber !== (record || []).length) {
      const otherRoles = global.info.character.filter((c) => !character_ids.includes(c.id)).map((c) => c.id);
      const possibleRoles = otherRoles.filter((c) => !knownRoles.includes(c));
      queryList = lodash.chain(queryList).concat(possibleRoles).uniq().value();
    }

    promises = queryList.map((c) => limit(() => getCharacters(uid, server, Array.isArray(c) ? c : [c], cookie)));
    (await Promise.allSettled(promises)).forEach(
      (c) =>
        "fulfilled" === c.status && 0 === c.value.retcode && (data.avatars = [...data.avatars, ...c.value.data.avatars])
    );
  }

  // 将拥有的角色列表写入数据库
  const allCharacters = data.avatars.map((c) => c.id);
  await db.update("character", "record", { uid }, { roles: allCharacters });

  const avatars = [];
  for (const i in data.avatars) {
    if (data.avatars[i]) {
      const el = data.avatars[i];
      const base = lodash.omit(el, ["image", "weapon", "reliquaries", "constellations"]);
      const weapon = lodash.omit(el.weapon, ["id", "type", "promote_level", "type_name"]);
      let artifact = [];
      let constellationNum = 0;
      const constellations = el.constellations.reverse();

      for (const level in constellations) {
        if (constellations[level]) {
          if (constellations[level].is_actived) {
            constellationNum = constellations[level].pos;
            break;
          }
        }
      }

      for (const posID in el.reliquaries) {
        if (el.reliquaries[posID]) {
          const posInfo = lodash.omit(el.reliquaries[posID], ["id", "set", "pos_name"]);
          artifact.push(posInfo);
        }
      }

      avatars.push({ ...base, weapon, artifact, constellationNum });
    }
  }

  db.update("info", "user", { uid }, { avatars });
}

export { abyDetail, baseDetail, characterDetail, handleDetailError, indexDetail };
