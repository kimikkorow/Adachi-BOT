import fs from "fs";
import lodash from "lodash";
import path from "path";
import puppeteer from "puppeteer";
import _url from "url";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { mkdir } from "../src/utils/file.js";

const __filename = _url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootdir = path.resolve(__dirname, "..");
const honeyUrl = "https://genshin.honeyhunterworld.com";
const bwikiUrl = "https://wiki.biligame.com/ys";
const types = {
  weapon: { sword: "单手剑", claymore: "双手剑", polearm: "长柄武器", bow: "弓", catalyst: "法器" },
  char: { "unreleased-and-upcoming-characters": "测试角色", characters: "角色" },
};
const elems = {
  anemo: "风元素",
  pyro: "火元素",
  geo: "岩元素",
  electro: "雷元素",
  cryo: "冰元素",
  hydro: "水元素",
  dendro: "草元素",
  none: "无",
};
const placeholder = "**占位符**";
let browser;

async function launch() {
  if (undefined === browser) {
    browser = await puppeteer.launch({
      defaultViewport: null,
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--no-first-run", "--no-zygote"],
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
    });
  }
}

async function close() {
  if (undefined !== browser) {
    await browser.close();
  }
}

async function getLink(name, type = "weapon") {
  if (!["weapon", "char"].includes(type)) {
    throw `Unknown type "${type}!"`;
  }

  const db = `${honeyUrl}/db/${type}`;
  const param = "lang=CHS";
  const urls = lodash
    .chain(Object.keys(types[type]))
    .map((c) => [types[type][c], `${db}/${c}/?${param}`])
    .fromPairs()
    .value();

  for (const typename of Object.keys(urls)) {
    process.stdout.write(`检测是否为${typename} ……`);

    const page = await browser.newPage();

    try {
      await page.goto(urls[typename], { waitUntil: "domcontentloaded" });

      switch (type) {
        case "char": {
          const handles = await page.$x("//div[contains(@class, 'char_sea_cont')]");

          for (const handle of handles) {
            const names = (
              await page.evaluate(
                (...h) => h.map((e) => e.textContent),
                ...(await handle.$x(".//span[contains(@class, 'sea_charname')]"))
              )
            ).filter((c) => "" !== c);

            if (names.includes(name)) {
              const link = await page.evaluate((e) => e.getAttribute("href"), (await handle.$x("./a"))[0]);
              await page.close();
              console.log("\t是");
              return link;
            }
          }

          break;
        }
        case "weapon":
          {
            const handles = await page.$x("//table[contains(@class, 'art_stat_table')]");

            for (const handle of handles) {
              const items = (
                await page.evaluate(
                  (...h) => h.map((e) => ({ name: e.textContent, link: e.getAttribute("href") })),
                  ...(await handle.$x("./tbody/tr/td[3]/a"))
                )
              ).filter((c) => "" !== c.name);

              if (items.map((c) => c.name).includes(name)) {
                const { link } = items.filter((c) => name === c.name)[0];
                await page.close();
                console.log("\t是");
                return link;
              }
            }
          }

          break;
      }
    } catch (e) {
      // do nothing
    }

    await page.close();
    console.log("\t不是");
  }

  return undefined;
}

async function getMaterialName(link) {
  const url = `${honeyUrl}/${link}`;
  const page = await browser.newPage();
  let name;

  try {
    await page.goto(encodeURI(url), { waitUntil: "domcontentloaded" });
    name = await page.evaluate((e) => e.textContent, (await page.$x("//div[contains(@class, 'custom_title')]"))[0]);
  } catch (e) {
    // do noting
  } finally {
    if (page) {
      await page.close();
    }
  }

  return name;
}

async function getMaterialTime(name) {
  const url = `${bwikiUrl}/${name}`;
  const page = await browser.newPage();
  let time;

  try {
    await page.goto(encodeURI(url), { waitUntil: "domcontentloaded" });
    const handle = (await page.$x("//table[contains(@class, 'wikitable')]"))[0];
    const text = await page.evaluate((e) => e.textContent, (await handle.$x("./tbody/tr[5]/td"))[0]);
    const zhou = text
      .match(/(?<=时间：).+/)[0]
      .split("/")
      .map((c) => c[1])
      .join("/");
    time = "【周" + zhou + "】";
  } catch (e) {
    // do noting
  } finally {
    if (page) {
      await page.close();
    }
  }

  return time;
}

// { type, title, id , name, introduce, birthday, element, cv, constellationName, rarity, mainStat, mainValue, baseATK,
//   ascensionMaterials, levelUpMaterials, talentMaterials, time, constellations }
async function getCharData(page) {
  const type = "角色";

  let handle = (await page.$x("//div[contains(@class, 'custom_title')]"))[0];
  const name = await page.evaluate((e) => e.textContent, handle);

  handle = (await page.$x("//table[contains(@class, 'item_main_table')]"))[0];
  const title = await page.evaluate((e) => e.textContent, (await handle.$x("./tbody/tr[2]/td[2]"))[0]);
  const introduce = await page.evaluate((e) => e.textContent, (await handle.$x("./tbody/tr[13]/td[2]"))[0]);
  const birthdayStr = await page.evaluate((e) => e.textContent, (await handle.$x("./tbody/tr[7]/td[2]"))[0]);
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  const [d, m] = birthdayStr.split(" ");
  const birthday = `${months.indexOf(m) + 1}月${d}日`;

  const elementLink = await page.evaluate(
    (e) => e.getAttribute("src"),
    (
      await handle.$x("./tbody/tr[6]/td[2]/img")
    )[0]
  );
  let element = "";

  for (const k of Object.keys(elems)) {
    if (elementLink.match(new RegExp(k))) {
      element = elems[k];
      break;
    }
  }

  const cvCN = await page.evaluate((e) => e.textContent, (await handle.$x("./tbody/tr[9]/td[2]"))[0]);
  const cvJP = await page.evaluate((e) => e.textContent, (await handle.$x("./tbody/tr[10]/td[2]"))[0]);
  const cv = `${cvCN} | ${cvJP}`;
  const constellationName = await page.evaluate((e) => e.textContent, (await handle.$x("./tbody/tr[8]/td[2]"))[0]);
  const rarity = ((await handle.$x("./tbody/tr[4]/td[2]/div[contains(@class, 'sea_char_stars_wrap')]")) || []).length;

  handle = (await page.$x("//table[contains(@class, 'add_stat_table')]"))[1];
  const stats = await page.evaluate((...h) => h.map((e) => e.textContent), ...(await handle.$x(`./tbody/tr[1]/td`)));
  let mainStatTdIndex = 1;

  for (let i = 0; i < stats.length; ++i) {
    if ("基础防御力" === stats[i]) {
      mainStatTdIndex = i + 1 + 1;
      break;
    }
  }

  const mainStat = await page.evaluate(
    (e) => e.textContent,
    (
      await handle.$x(`./tbody/tr[1]/td[${mainStatTdIndex}]`)
    )[0]
  );
  let mainValue = await page.evaluate(
    (e) => e.textContent,
    (
      await handle.$x(`./tbody/tr[15]/td[${mainStatTdIndex}]`)
    )[0]
  );
  const baseATK = await page.evaluate((e) => e.textContent, (await handle.$x("./tbody/tr[15]/td[3]"))[0]);

  switch (mainStat) {
    case "暴击率":
      mainValue = `${(parseFloat(mainValue) - 5).toFixed(1)}%`;
      break;
    case "暴击伤害":
      mainValue = `${(parseFloat(mainValue) - 50).toFixed(1)}%`;
      break;
  }

  const ascensionMaterials = [];
  const levelUpMaterials = [];
  const extraElemCol = stats.length > 8;

  for (const i of [3, 5, 9, 13]) {
    ascensionMaterials.push(
      await getMaterialName(
        await page.evaluate(
          (e) => e.getAttribute("href"),
          (
            await handle.$x(`./tbody/tr[${i}]/td[${extraElemCol ? 8 : 7}]/div[1]/a`)
          )[0]
        )
      )
    );
  }

  ascensionMaterials.push(
    await getMaterialName(
      await page.evaluate(
        (e) => e.getAttribute("href"),
        (
          await handle.$x(`./tbody/tr[5]/td[${extraElemCol ? 8 : 7}]/div[2]/a`)
        )[0]
      )
    )
  );
  levelUpMaterials.push(
    await getMaterialName(
      await page.evaluate(
        (e) => e.getAttribute("href"),
        (
          await handle.$x(`./tbody/tr[3]/td[${extraElemCol ? 8 : 7}]/div[2]/a`)
        )[0]
      )
    )
  );

  for (const i of [5, 7, 11]) {
    levelUpMaterials.push(
      await getMaterialName(
        await page.evaluate(
          (e) => e.getAttribute("href"),
          (
            await handle.$x(`./tbody/tr[${i}]/td[${extraElemCol ? 8 : 7}]/div[4]/a`)
          )[0]
        )
      )
    );
  }

  const liveDataHandle = (await page.$x("//div[contains(@id, 'live_data')]"))[0];
  const skilldmgwrapperHandles = await liveDataHandle.$x(".//div[contains(@class, 'skilldmgwrapper')]");
  const hasFourSkill = skilldmgwrapperHandles.length > 5;

  handle = (await page.$x("//table[contains(@class, 'item_main_table')]"))[2];
  const skillE = await page.evaluate((e) => e.textContent, (await handle.$x("./tbody/tr[1]/td[2]/a"))[0]);
  handle = (await page.$x("//table[contains(@class, 'item_main_table')]"))[true === hasFourSkill ? 4 : 3];
  const skillQ = await page.evaluate((e) => e.textContent, (await handle.$x("./tbody/tr[1]/td[2]/a"))[0]);

  handle = (await page.$x("//table[contains(@class, 'add_stat_table')]"))[true === hasFourSkill ? 6 : 5];
  const talentMaterials = [];

  for (const i of [2, 3, 7]) {
    talentMaterials.push(
      await getMaterialName(
        await page.evaluate((e) => e.getAttribute("href"), (await handle.$x(`./tbody/tr[${i}]/td[2]/div[1]/a`))[0])
      )
    );
  }

  talentMaterials.push(
    await getMaterialName(
      await page.evaluate((e) => e.getAttribute("href"), (await handle.$x("./tbody/tr[7]/td[2]/div[3]/a"))[0])
    )
  );

  handle = (await page.$x("//table[contains(@class, 'item_main_table')]"))[true === hasFourSkill ? 6 : 5];
  const constellations = await page.evaluate(
    (E, Q, ...h) => h.map((e) => e.textContent.trim().replace(/\s/g, "").replace(E, "元素战技").replace(Q, "元素爆发")),
    skillE.trim().replace("·", "•"),
    skillQ.trim().replace("·", "•"),
    ...(await handle.$x(".//div[contains(@class, 'skill_desc_layout')]"))
  );

  handle = (await page.$x("//div[contains(@class, 'homepage_index_cont')]"))[1];
  const face = await page.evaluate((e) => e.getAttribute("href"), (await handle.$x("./div/div[5]/a"))[0]);
  const id = parseInt(face.match(/\d+/)[0]);
  const time = await getMaterialTime(talentMaterials[0]);

  return {
    type,
    title,
    id,
    name,
    introduce,
    birthday,
    element,
    cv,
    constellationName,
    rarity,
    mainStat,
    mainValue,
    baseATK,
    ascensionMaterials,
    levelUpMaterials,
    talentMaterials,
    time,
    constellations,
  };
}

// { type, title, name, introduce, access, rarity, mainStat, mainValue, baseATK, ascensionMaterials, time, skillName,
//   skillContent }
async function getWeaponData(page) {
  const type = "武器";

  let handle = (await page.$x("//div[contains(@class, 'custom_title')]"))[0];
  const name = await page.evaluate((e) => e.textContent, handle);

  handle = (await page.$x("//table[contains(@class, 'item_main_table')]"))[1];
  const title =
    types.weapon[
      (await page.evaluate((e) => e.textContent, (await handle.$x("./tbody/tr[1]/td[3]/a"))[0])).toLowerCase()
    ];
  const introduce = await page.evaluate((e) => e.textContent, (await handle.$x("./tbody/tr[8]/td[2]"))[0]);
  const access = placeholder;
  const rarity = ((await handle.$x("./tbody/tr[2]/td[2]/div[contains(@class, 'sea_char_stars_wrap')]")) || []).length;
  const mainStat = await page.evaluate((e) => e.textContent, (await handle.$x("./tbody/tr[4]/td[2]"))[0]);
  const skillName = await page.evaluate((e) => e.textContent, (await handle.$x("./tbody/tr[6]/td[2]"))[0]);
  let skillContent = "";

  if (rarity > 2) {
    handle = (await page.$x("//table[contains(@class, 'add_stat_table')]"))[3];
    const contents = await page.evaluate(
      (...h) => h.map((e) => e.textContent),
      ...(await handle.$x("./tbody/tr/td[2]")).slice(0, 6)
    );
    const numReg = /\b\d+?\b/g;
    const numsList = contents.map((c) => c.match(numReg));
    const texts = contents[0].split(numReg);

    for (let i = 0; i < texts.length - 1; ++i) {
      skillContent += texts[i];

      for (const nums of numsList) {
        skillContent += `${nums[i]}/`;
      }

      skillContent = skillContent.slice(0, -1);
    }

    skillContent += texts[texts.length - 1];
  }

  handle = (await page.$x("//table[contains(@class, 'add_stat_table')]"))[2];
  const maxLvTr = parseInt(rarity) > 2 ? 26 : 20;
  const mainValue = await page.evaluate((e) => e.textContent, (await handle.$x(`./tbody/tr[${maxLvTr}]/td[3]`))[0]);
  const baseATK = await page.evaluate((e) => e.textContent, (await handle.$x(`./tbody/tr[${maxLvTr}]/td[2]`))[0]);
  const ascensionMaterials = [[], []];

  for (const i of [7, 12, 18].concat(rarity > 2 ? [24] : [])) {
    ascensionMaterials[0].push(
      await getMaterialName(
        await page.evaluate((e) => e.getAttribute("href"), (await handle.$x(`./tbody/tr[${i}]/td[4]/a[1]`))[0])
      )
    );
  }

  for (const i1 of [2, 3]) {
    for (const i2 of [7, 15].concat(rarity > 2 ? [21] : [])) {
      ascensionMaterials[1].push(
        await getMaterialName(
          await page.evaluate((e) => e.getAttribute("href"), (await handle.$x(`./tbody/tr[${i2}]/td[4]/a[${i1}]`))[0])
        )
      );
    }
  }

  const time = await getMaterialTime(ascensionMaterials[0][0]);

  return {
    type,
    title,
    name,
    introduce,
    access,
    rarity,
    mainStat,
    mainValue,
    baseATK,
    ascensionMaterials,
    time,
    skillName,
    skillContent,
  };
}

async function getData(link, type = "weapon") {
  process.stdout.write(`正在拉取数据 ……`);

  const url = `${honeyUrl}/${link}`;
  const page = await browser.newPage();
  let data;

  try {
    await page.goto(encodeURI(url), { waitUntil: "domcontentloaded" });

    switch (type) {
      case "char":
        data = await getCharData(page);
        break;
      case "weapon":
        data = await getWeaponData(page);
        break;
    }
  } catch (e) {
    data = undefined;
  } finally {
    if (page) {
      await page.close();
    }
  }

  console.log(undefined === data ? "\t失败" : "\t成功");
  return data;
}

function writeData(name, data = {}, file = undefined) {
  const defaultDir = mkdir(path.resolve(rootdir, "resources_custom", "Version2", "info", "docs"));
  let old = {};

  if ("string" !== typeof file) {
    file = path.resolve(defaultDir, `${name}.json`);
  }

  if (undefined === data) {
    console.log("数据错误。");
    return;
  }

  if (fs.existsSync(file)) {
    // FIXME 这个字段从哪儿能拼出来？
    old = lodash.pick(JSON.parse(fs.readFileSync(file)), "access");
  }

  process.stdout.write(`正在写入文件“${file}” ……`);
  fs.writeFileSync(file, JSON.stringify(lodash.assign(data, old), null, 2));
  console.log("\t成功");
}

async function main() {
  const argv = yargs(hideBin(process.argv))
    .usage("-n <string>")
    .example("-n 刻晴")
    .example("-n 天空之刃")
    .help("help")
    .alias("help", "h")
    .version(false)
    .options({
      name: {
        alias: "n",
        type: "string",
        description: "名称",
        requiresArg: true,
        required: false,
      },
      output: {
        alias: "o",
        type: "string",
        description: "目标文件路径",
        requiresArg: true,
        required: false,
      },
    }).argv;

  if ("string" === typeof argv.name && "" !== argv.name) {
    try {
      process.stdout.write("正在启动浏览器 ……");
      await launch();
      console.log("\t成功");

      for (const type of ["char", "weapon"]) {
        const link = await getLink(argv.name, type);

        if ("string" === typeof link) {
          const data = await getData(link, type);

          if (undefined !== data) {
            writeData(argv.name, data, argv.output || undefined);
            return;
          }

          console.log("数据获取错误，无法继续。");
          return;
        }
      }
    } catch (e) {
      // do nothing
    } finally {
      await close();
    }

    console.log(`没有找到名为“${argv.name}”的角色或武器。`);
    return;
  }
}

main().then((n) => process.exit(n));