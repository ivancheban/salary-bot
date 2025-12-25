// index.js

// Dependencies
const { Telegraf } = require("telegraf");
const moment = require("moment-timezone");

// --- Configuration ---
const BOT_TOKEN = process.env.TOKEN;
const KYIV_TZ = "Europe/Kiev";
const CHAT_ID = "-1001581609986";
const COMMAND_COOLDOWN_MS = 5000;

const isLocalRun =
  require.main === module &&
  !process.env.AWS_LAMBDA_FUNCTION_NAME &&
  !process.env.FUNCTION_TARGET &&
  !process.env.FUNCTIONS_SIGNATURE_TYPE;

// --- Basic Startup Check ---
if (!isLocalRun && !BOT_TOKEN) {
  console.error(
    "FATAL ERROR: Bot token not provided in environment variable 'TOKEN'"
  );
  throw new Error("Bot token not provided in environment variable 'TOKEN'");
}

const bot = isLocalRun ? { telegram: { getMe: () => Promise.resolve({ username: 'local_bot' }) }, on: () => {}, handleUpdate: () => {} } : new Telegraf(BOT_TOKEN);

// --- State ---
let lastNotificationDate = null;
const userLastCommandTime = {};

// --- Date/Holiday Functions ---
function isEndOfQuarter(date) {
  const month = date.month(); // 0-indexed (0=Jan, 11=Dec)
  return month === 2 || month === 5 || month === 8 || month === 11;
}

function easter(year) {
  /* ... unchanged ... */
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d =
    (19 * a +
      b -
      Math.floor(b / 4) -
      Math.floor((b - Math.floor((b + 8) / 25) + 1) / 3) +
      15) %
    30;
  const e = (32 + 2 * (b % 4) + 2 * Math.floor(c / 4) - d - (c % 4)) % 7;
  const f = d + e - 7 * Math.floor((a + 11 * d + 22 * e) / 451) + 114;
  const month = Math.floor(f / 31);
  const day = (f % 31) + 1;
  return moment.tz([year, month - 1, day], KYIV_TZ);
}
function isUkrainianHoliday(date) {
  /* ... unchanged ... */
  const year = date.year();
  const month = date.month() + 1;
  const day = date.date();
  const fixedHolidays = [
    [1, 1],
    [1, 7],
    [3, 8],
    [5, 1],
    [5, 9],
    [6, 28],
    [8, 24],
    [10, 14],
    [12, 25],
  ];
  if (fixedHolidays.some(([m, d]) => month === m && day === d)) return true;
  const easterDate = easter(year);
  const trinityDate = easterDate.clone().add(49, "days");
  if (date.isSame(trinityDate, "day")) return true;
  return false;
}

// --- Salary Calculation Logic ---
function adjustForWeekendHoliday(dateToAdjust, timezone) {
  /* ... unchanged ... */
  let adjustments = 0;
  const maxAdjustments = 7;
  let adjustedDate = dateToAdjust.clone();
  while (adjustments < maxAdjustments) {
    const dayOfWeek = adjustedDate.day();
    if (
      dayOfWeek === 0 ||
      dayOfWeek === 6 ||
      isUkrainianHoliday(adjustedDate)
    ) {
      adjustedDate.subtract(1, "day");
      adjustments++;
      continue;
    }
    break;
  }
  if (adjustments >= maxAdjustments) {
    console.error(
      "[adjustDate] Exceeded max adjustments for " +
        dateToAdjust.format("YYYY-MM-DD")
    );
    return dateToAdjust;
  }
  if (adjustments > 0 && !dateToAdjust.isSame(adjustedDate, "day")) {
    console.log(
      `[adjustDate] ${dateToAdjust.format(
        "YYYY-MM-DD"
      )} adjusted to ${adjustedDate.format("YYYY-MM-DD")}`
    );
  }
  return adjustedDate;
}

// *** REFINED getNextSalaryDate ***
function getNextSalaryDate(currentDate) {
  console.log(
    "[getNextSalaryDate] Input:",
    currentDate.format("YYYY-MM-DD HH:mm Z")
  );
  const salaryTime = { hour: 12, minute: 10, second: 0, millisecond: 0 };
  const currentYear = currentDate.year();

  const targetDatesRaw = [];
  const monthsFollowingQuarterEnd = [0, 3, 6, 9]; // Jan, Apr, Jul, Oct

  // Generate all potential salary dates for the current and next year
  for (let yearOffset = 0; yearOffset <= 1; yearOffset++) {
    const year = currentYear + yearOffset;
    for (let month = 0; month < 12; month++) {
      const currentMoment = moment.tz([year, month], KYIV_TZ);

      // Add payment on the 5th, UNLESS it's a month following a quarter-end
      if (!monthsFollowingQuarterEnd.includes(month)) {
        targetDatesRaw.push(moment.tz([year, month, 5], KYIV_TZ));
      }

      // Add end-of-month payment for quarter-end months
      if (isEndOfQuarter(currentMoment)) {
        targetDatesRaw.push(moment.tz([year, month], KYIV_TZ).endOf('month'));
      }
    }
  }

  // Adjust all dates for weekends/holidays and sort them
  const adjustedDates = targetDatesRaw.map(date => adjustForWeekendHoliday(date, KYIV_TZ));

  // Remove duplicates and sort
  const uniqueAdjustedDates = Array.from(new Set(adjustedDates.map(d => d.format('YYYY-MM-DD'))))
    .map(ds => moment.tz(ds, 'YYYY-MM-DD', KYIV_TZ))
    .sort((a, b) => a.valueOf() - b.valueOf());

  // --- One-time override: replace Dec 31, 2025 with Dec 29, 2025 ---
  // This implements the requested exceptional date without changing general rules.
  for (let i = 0; i < uniqueAdjustedDates.length; i++) {
    if (uniqueAdjustedDates[i].isSame(moment.tz([2025, 11, 31], KYIV_TZ), 'day')) {
      uniqueAdjustedDates[i] = moment.tz([2025, 11, 29], KYIV_TZ);
      console.log('[getNextSalaryDate] One-time override applied: 2025-12-31 -> 2025-12-29');
    }
  }


  // Find the next salary date from the sorted list
  for (const targetDate of uniqueAdjustedDates) {
    const targetDateTime = targetDate.clone().set(salaryTime);
    if (targetDateTime.isAfter(currentDate)) {
      console.log(
        "[getNextSalaryDate] Final chosen salary date:",
        targetDateTime.format("YYYY-MM-DD HH:mm Z")
      );
      return targetDateTime;
    }
  }


  console.error(
    "[getNextSalaryDate] FATAL: No next date found after processing all targets!"
  );
  return moment().add(10, "years"); // Return error date
}
// *** END OF REFINED getNextSalaryDate ***

// --- Message Formatting ---
function getSalaryMessage(now, nextSalary) {
  /* ... unchanged ... */
  if (!moment.isMoment(now) || !moment.isMoment(nextSalary)) {
    console.error("[getSalaryMessage] Invalid input.");
    return "Error calculating time difference.";
  }
  if (now.isSame(nextSalary, "day"))
    return "🎉🎊 It's Salary Day! 💰💸 Enjoy your well-earned money! 🥳🍾";
  const difference = nextSalary.diff(now);
  if (difference < 0) {
    console.warn(
      `[getSalaryMessage] Past date calculated: ${nextSalary.format()}`
    );
    return `🤔 Calculation error.`;
  }
  const duration = moment.duration(difference);
  const days = Math.floor(duration.asDays());
  const hours = duration.hours();
  const minutes = duration.minutes();
  const seconds = duration.seconds();
  if (days === 0)
    return `⏰ Only ${hours}h ${minutes}m ${seconds}s left until Salary Day! 💰 Get ready to celebrate! 🎉`;
  if (days === 1)
    return `⏰ Only 1 day and ${hours}h ${minutes}m left until Salary Day! 💰 Get ready to celebrate! 🎉`;
  if (days === 2)
    return "🗓 2 days to go until Salary Day! 💼 The wait is almost over! 😊";
  if (days === 3)
    return "📅 3 days remaining until Salary Day! 💰 It's getting closer! 🙌";
  else {
    const countdownText = `${days}d ${hours}h ${minutes}m ${seconds}s`;
    const nextSalaryText = `Next salary: ${nextSalary.format("MMMM D, YYYY")}`;
    return `⏳ Time until next salary: ${countdownText}\n📆 ${nextSalaryText}`;
  }
}

// --- Bot Event Handlers ---
bot.on("message", async (ctx) => {
  /* ... unchanged ... */
  const chatInfo = ctx.chat;
  const userInfo = ctx.from;
  const messageText = ctx.message?.text;
  const nowMs = Date.now();
  console.log(
    `\n--- [Msg] Chat: ${chatInfo.id} (${chatInfo.type}) | User: ${
      userInfo.id
    } (${userInfo.username || "?"}) | Text: "${
      messageText || "[Non-text]"
    }" ---`
  );
  if (messageText) {
    const botUsername = ctx.botInfo?.username;
    const commandMatches =
      messageText === "/when_salary" ||
      (botUsername && messageText === `/when_salary@${botUsername}`);
    if (commandMatches) {
      const userId = userInfo.id;
      const lastTime = userLastCommandTime[userId] || 0;
      if (nowMs - lastTime < COMMAND_COOLDOWN_MS) {
        console.log(`[Cooldown] User ${userId} blocked.`);
        return;
      }
      userLastCommandTime[userId] = nowMs;
      console.log(
        `[Handler] Command from User ${userId} in chat ${chatInfo.id}`
      );
      const calculationStart = moment().tz(KYIV_TZ);
      try {
        const nextSalary = getNextSalaryDate(calculationStart.clone());
        const message = getSalaryMessage(calculationStart, nextSalary);
        console.log(`[Handler] Replying to ${userId}`);
        await ctx.reply(message);
        console.log(`[Handler] Reply OK.`);
      } catch (e) {
        console.error(`[Handler] Error for ${userId}:`, e);
        try {
          if (!(nowMs - lastTime < COMMAND_COOLDOWN_MS))
            await ctx.reply("Sorry, an error occurred.");
        } catch (e2) {
          console.error(`[Handler] Fail reply err:`, e2);
        }
      }
    }
  }
});

// --- Notification Function ---
async function sendDailyNotification(targetChatId) {
  /* ... unchanged ... */
  const now = moment().tz(KYIV_TZ);
  console.log(`[Notify] Gen for ${targetChatId} at`, now.format());
  try {
    const nextSalary = getNextSalaryDate(now.clone());
    const message = getSalaryMessage(now, nextSalary);
    console.log("[Notify] Msg:", message);
    await bot.telegram.sendMessage(targetChatId, message);
    console.log("[Notify] Sent OK to:", targetChatId);
    return true;
  } catch (e) {
    console.error(`[Notify] Fail send to ${targetChatId}:`, e);
    if (e.response?.error_code === 403)
      console.error(`[Notify] Blocked/kicked from ${targetChatId}?`);
    else if (
      e.response?.error_code === 400 &&
      e.response?.description.includes("chat not found")
    )
      console.error(`[Notify] Chat ${targetChatId} not found.`);
    return false;
  }
}

// --- Serverless Function Handler ---
exports.handler = async (event, context) => {
  /* ... unchanged ... */
  const startTime = Date.now();
  const invocationId = context?.awsRequestId || `local-${startTime}`;
  console.log(
    `[Handler ${invocationId}] Start ${new Date(startTime).toISOString()}`
  );
  try {
    let requestBody = null;
    if (event.body && typeof event.body === "string") {
      try {
        requestBody = JSON.parse(event.body);
      } catch (e) {
        console.error(`[Handler ${invocationId}] JSON err:`, e);
        return {
          statusCode: 400,
          body: JSON.stringify({ error: "Invalid JSON" }),
        };
      }
    } else if (event.update_id) {
      requestBody = event;
    } else if (
      event.trigger === "daily_notification" ||
      event.source === "aws.events" ||
      event["detail-type"]
    ) {
      requestBody = { trigger: "daily_notification" };
    } else {
      requestBody = {};
    }
    console.log(
      `[Handler ${invocationId}] Type: ${
        requestBody.trigger
          ? "Notify"
          : requestBody.update_id
          ? "Update"
          : "Unknown"
      }`
    );
    if (requestBody.trigger === "daily_notification") {
      const now = moment().tz(KYIV_TZ);
      const today = now.format("YYYY-MM-DD");
      if (lastNotificationDate !== today) {
        console.log(
          `[Handler ${invocationId}] Send daily for ${today} (Last: ${
            lastNotificationDate || "N/A"
          })`
        );
        const success = await sendDailyNotification(CHAT_ID);
        if (success) {
          lastNotificationDate = today;
          console.log(`[Handler ${invocationId}] Daily OK.`);
          return {
            statusCode: 200,
            body: JSON.stringify({
              message: "Daily notification sent successfully",
            }),
          };
        } else {
          console.error(`[Handler ${invocationId}] Daily Fail.`);
          return {
            statusCode: 500,
            body: JSON.stringify({
              error: "Failed to send daily notification",
            }),
          };
        }
      } else {
        console.log(`[Handler ${invocationId}] Daily skip (${today}).`);
        return {
          statusCode: 200,
          body: JSON.stringify({ message: "Notification already sent today" }),
        };
      }
    } else if (requestBody.update_id) {
      console.log(`[Handler ${invocationId}] Update ${requestBody.update_id}`);
      if (!bot.botInfo) {
        try {
          bot.botInfo = await bot.telegram.getMe();
          console.log(
            `[Handler ${invocationId}] Bot: @${bot.botInfo.username}`
          );
        } catch (e) {
          console.error(`[Handler ${invocationId}] getMe err:`, e);
        }
      }
      await bot.handleUpdate(requestBody);
      console.log(`[Handler ${invocationId}] Update OK.`);
      return { statusCode: 200, body: JSON.stringify({ message: "OK" }) };
    } else {
      console.log(`[Handler ${invocationId}] Unknown req.`);
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Unrecognized request" }),
      };
    }
  } catch (e) {
    console.error(`[Handler ${invocationId}] CRITICAL:`, e);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal server error" }),
    };
  } finally {
    console.log(
      `[Handler ${invocationId}] End. Dur: ${Date.now() - startTime}ms`
    );
  }
};

// --- Utility Function (for local testing) ---
function getSalaryDatesForYear(yearToTest) {
  /* ... unchanged ... */
  console.log(`\n[Test] Salary dates for ${yearToTest}...`);
  let currentDate = moment.tz([yearToTest - 1, 11, 30], KYIV_TZ); // Start from one day before the year
  let salaryDates = new Set();
  let calcCount = 0;
  const maxCalc = 30; // Increased for more dates per year
  while (currentDate.year() < yearToTest + 1 && calcCount < maxCalc) {
    calcCount++;
    let nextSalaryDate = getNextSalaryDate(currentDate.clone());
    if (nextSalaryDate.year() >= yearToTest + 2) { // Check for large jumps
      console.error("[Test] Error date from calc - jumped too far.", nextSalaryDate.format());
      break;
    }
    if (nextSalaryDate.year() === yearToTest) {
      const fmtDate = nextSalaryDate.format("YYYY-MM-DD");
      if (!salaryDates.has(fmtDate)) {
        salaryDates.add(fmtDate);
        console.log(` -> ${nextSalaryDate.format("YYYY-MM-DD dddd, HH:mm")}`);
      }
    } else if (nextSalaryDate.year() > yearToTest) {
        // If we've passed the target year, we can stop.
        break;
    }
    // This check was flawed. The new date can be the same day if the time is later.
    // The core logic in getNextSalaryDate already ensures we are moving forward in time.
    if (nextSalaryDate.isSameOrBefore(currentDate)) {
       console.error("[Test] Loop Error: Not progressing in time.", {
        cur: currentDate.format(),
        calc: nextSalaryDate.format(),
      });
      // To prevent infinite loop, manually advance the date
      currentDate.add(1, 'day');
      continue;
    }
    currentDate = nextSalaryDate.clone();
  }
  if (calcCount >= maxCalc) console.warn(`[Test] Max calcs reached.`);
  console.log(`[Test] Found ${salaryDates.size} dates for ${yearToTest}.`);
  return Array.from(salaryDates).sort();
}

// --- Optional: Local Execution & Startup Log ---
if (
  require.main === module &&
  !process.env.AWS_LAMBDA_FUNCTION_NAME &&
  !process.env.FUNCTION_TARGET &&
  !process.env.FUNCTIONS_SIGNATURE_TYPE
) {
  console.log("--- Local Test ---");
  const y1 = 2025;
  const d1 = getSalaryDatesForYear(y1);
  console.log(`\nDates ${y1}:\n${d1.join("\n")}`);
  const y2 = 2026;
  const d2 = getSalaryDatesForYear(y2);
  console.log(`\nDates ${y2}:\n${d2.join("\n")}`);
  console.log("\n--- Test End ---");
}
bot.telegram
  .getMe()
  .then((i) => console.log(`[Startup] OK: @${i.username}`))
  .catch((e) => console.error("[Startup] CRITICAL FAIL:", e));
