import fs from "fs";
import lodash from "lodash";
import path from "path";
import puppeteer from "puppeteer";
import { mkdir } from "#utils/file";

("use strict");

// selector: 截图的页面元素。遵循 CSS 选择器语法。
// hello:    耗时操作是否给提示
// scale:    截图时的缩放比例。在纵横方向上各应使用多少屏幕实际像素来绘制单个CSS像素。效果约等同于 devicePixelRatio 。
// delete:   是否撤回消息
//
// selector -> view (string): selector (string)
// hello    -> view (string): hello (boolean)
// scale    -> view (string): scale (number)
// hello    -> view (string): delete (boolean)
//
// 如果没有设置则使用 m_SETTINGS_DEF 中的默认值
const m_SETTINGS = Object.freeze({
  selector: {},
  hello: {
    "genshin-aby": true,
    "genshin-card": true,
    "genshin-card-8": true,
    "genshin-package": true,
  },
  scale: {
    "genshin-aby": 2,
    "genshin-artifact": 1.2,
    "genshin-card": 2,
    "genshin-material": 2,
  },
  delete: {
    "genshin-artifact": true,
    "genshin-gacha": true,
  },
});
const m_SETTINGS_DEF = Object.freeze({
  selector: "body",
  hello: false,
  scale: 1.5,
  delete: false,
});
const m_RENDER_PATH = Object.freeze(puppeteer.executablePath());

async function renderOpen() {
  if (undefined === global.browser) {
    global.browser = await puppeteer.launch({
      defaultViewport: null,
      headless: lodash.hasIn(global.config, "viewDebug") ? 1 !== global.config.viewDebug : false,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--no-first-run",
        "--process-per-site",
        "--no-default-browser-check",
        "--disable-infobars",
      ],
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
    });
  }
}

async function renderClose() {
  if (undefined !== global.browser) {
    await global.browser.close();
    global.browser = undefined;
  }
}

async function render(msg, data, name) {
  const recordDir = path.resolve(global.datadir, "record");
  let binary;

  if ((m_SETTINGS.hello[name] || m_SETTINGS_DEF.hello) && global.config.warnTimeCosts && undefined !== msg.bot) {
    msg.bot.say(msg.sid, "正在绘图，请稍等……", msg.type, msg.uid, true);
  }

  // 抽卡信息太多时减少缩放比
  if ("genshin-gacha" === name && Array.isArray(data.data) && data.data.length > 10) {
    m_SETTINGS.scale["genshin-gacha"] = 1;
  }

  try {
    const dataStr = JSON.stringify(data);

    if (undefined !== msg.bot) {
      // 该文件仅用于辅助前端调试，无实际作用亦不阻塞
      const record = path.resolve(mkdir(path.resolve(recordDir, "last_params")), `${name}.json`);
      fs.writeFile(record, dataStr, () => {});

      if (undefined !== msg.bot) {
        msg.bot.logger.debug(`render：已生成 ${name} 功能的数据调试文件。`);
      }
    }

    if (undefined === global.browser) {
      throw "未找到可用的浏览器";
    }

    const page = await global.browser.newPage();
    const scale = m_SETTINGS.scale[name] || m_SETTINGS_DEF.scale;

    // 只在机器人发送图片时设置 viewport
    if (undefined !== msg.bot) {
      await page.setViewport({
        width: await page.evaluate(() => document.body.clientWidth),
        height: await page.evaluate(() => document.body.clientHeight),
        deviceScaleFactor: scale,
      });
    }

    if (undefined !== msg.bot) {
      msg.bot.logger.debug(`render：已设置 ${name} 功能的缩放比为 ${scale} 。`);
    }

    // 数据使用 URL 参数传入
    const param = { data: new Buffer.from(dataStr, "utf8").toString("base64") };
    await page.goto(`http://localhost:9934/src/views/${name}.html?${new URLSearchParams(param)}`);

    const html = await page.$(m_SETTINGS.selector[name] || m_SETTINGS_DEF.selector, { waitUntil: "networkidle0" });
    binary = await html.screenshot({
      encoding: "binary",
      type: "jpeg",
      quality: 100,
      omitBackground: true,
    });

    if (1 !== global.config.viewDebug) {
      await page.close();
    }
  } catch (e) {
    if (undefined !== msg.bot) {
      msg.bot.logger.error(`错误： ${name} 功能绘图失败，因为“${e}”。`, msg.uid);
      msg.bot.say(msg.sid, "绘图失败。", msg.type, msg.uid, true);
    }
    return;
  }

  if (binary) {
    const base64 = new Buffer.from(binary, "utf8").toString("base64");
    const imageCQ = `[CQ:image,type=image,file=base64://${base64}]`;
    const toDelete = undefined === m_SETTINGS.delete[name] ? m_SETTINGS_DEF.delete : m_SETTINGS.delete[name];
    const record = path.resolve(mkdir(path.resolve(recordDir, name)), `${msg.sid}.jpeg`);

    if (undefined !== msg.bot) {
      msg.bot.say(msg.sid, imageCQ, msg.type, msg.uid, toDelete, "\n");

      if (1 === global.config.saveImage) {
        fs.writeFile(record, binary, () => {});
      }
    }
  }
}

export { render, renderClose, renderOpen, m_RENDER_PATH as renderPath };
