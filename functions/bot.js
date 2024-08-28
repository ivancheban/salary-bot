const { Telegraf } = require('telegraf');
const moment = require('moment-timezone');
const cron = require('node-cron');

const bot = new Telegraf(process.env.TOKEN);
const KYIV_TZ = 'Europe/Kiev';

function easter(year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = (19 * a + b - Math.floor(b / 4) - Math.floor((b - Math.floor((b + 8) / 25) + 1) / 3) + 15) % 30;
    const e = (32 + 2 * (b % 4) + 2 * Math.floor(c / 4) - d - (c % 4)) % 7;
    const f = d + e - 7 * Math.floor((a + 11 * d + 22 * e) / 451) + 114;
    const month = Math.floor(f / 31);
    const day = (f % 31) + 1;
    return moment.tz([year, month - 1, day], KYIV_TZ);
}

function isUkrainianHoliday(date) {
    const fixedHolidays = [
        [1, 1],   // New Year's Day
        [3, 8],   // International Women's Day
        [5, 1],   // International Workers' Day
        [5, 8],   // Day of Remembrance and Victory over Nazism in World War II
        [6, 28],  // Constitution Day
        [7, 15],  // Statehood Day (since 2023)
        [8, 24],  // Independence Day
        [10, 1],  // Defenders of Ukraine Day (since 2023)
        [12, 25], // Christmas
    ];

    if (fixedHolidays.some(([month, day]) => date.month() + 1 === month && date.date() === day)) {
        return true;
    }

    const easterDate = easter(date.year());
    const pentecostDate = easterDate.clone().add(49, 'days');

    return date.isSame(easterDate, 'day') || date.isSame(pentecostDate, 'day');
}

function getNextSalaryDate(currentDate) {
    let nextSalary;

    if (currentDate.isBefore(moment.tz('2024-09-05', KYIV_TZ))) {
        nextSalary = moment.tz('2024-09-05', KYIV_TZ);
    } else if (currentDate.isSame(moment.tz('2024-09-05', KYIV_TZ), 'day')) {
        nextSalary = moment.tz('2024-09-30', KYIV_TZ);
    } else {
        nextSalary = currentDate.clone().startOf('month').add(4, 'days');
        if (currentDate.isAfter(nextSalary)) {
            nextSalary.add(1, 'month');
        }

        const quarterEndMonths = [3, 6, 9, 12];
        if (quarterEndMonths.includes(nextSalary.month() + 1)) {
            nextSalary = nextSalary.endOf('month');
        }

        while (nextSalary.day() >= 5 || isUkrainianHoliday(nextSalary)) {
            nextSalary.subtract(1, 'day');
        }
    }

    return nextSalary;
}

function getSalaryMessage(now, nextSalary) {
    const difference = nextSalary.diff(now);
    const duration = moment.duration(difference);
    const days = Math.floor(duration.asDays());
    const hours = duration.hours();
    const minutes = duration.minutes();
    const seconds = duration.seconds();

    if (days === 0 && hours === 0 && minutes === 0) {
        return "🎉🎊 It's Salary Day! 💰💸 Enjoy your well-earned money! 🥳🍾";
    } else if (days === 1) {
        return "⏰ Only 1 day left until Salary Day! 💰 Get ready to celebrate! 🎉";
    } else if (days === 2) {
        return "🗓 2 days to go until Salary Day! 💼 The wait is almost over! 😊";
    } else if (days === 3) {
        return "📅 3 days remaining until Salary Day! 💰 It's getting closer! 🙌";
    } else {
        const countdownText = `${days}d ${hours}h ${minutes}m ${seconds}s`;
        const nextSalaryText = `Next Salary: ${nextSalary.format('MMMM D, YYYY')}`;
        return `⏳ Time until next salary: ${countdownText}\n📆 ${nextSalaryText}`;
    }
}

bot.command('when_salary', (ctx) => {
    const now = moment().tz(KYIV_TZ);
    const nextSalary = getNextSalaryDate(now);
    const message = getSalaryMessage(now, nextSalary);
    ctx.reply(message);
});

async function dailySalaryNotification(bot) {
    try {
        console.log("Executing scheduled job...");
        const now = moment().tz(KYIV_TZ);
        const nextSalary = getNextSalaryDate(now);
        const message = getSalaryMessage(now, nextSalary);

        const response = await bot.telegram.sendMessage('-1001581609986', message);
        console.log(`Message sent with message id ${response.message_id}`);
    } catch (e) {
        console.error(`Failed to send message: ${e.message}`);
    }
}

// Schedule daily notification
cron.schedule('30 10 * * *', () => dailySalaryNotification(bot), {
    timezone: KYIV_TZ
});

exports.handler = async (event) => {
    try {
        await bot.handleUpdate(JSON.parse(event.body));
        return { statusCode: 200, body: 'OK' };
    } catch (e) {
        console.error('Error in handler:', e);
        return { statusCode: 400, body: 'This endpoint is meant for bot and telegram communication' };
    }
};