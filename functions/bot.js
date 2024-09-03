const { Telegraf } = require('telegraf');
const moment = require('moment-timezone');

const bot = new Telegraf(process.env.TOKEN);
const KYIV_TZ = 'Europe/Kiev';
const CHAT_ID = '-1001581609986';

let lastNotificationDate = null;

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
        [1, 7],   // Orthodox Christmas
        [3, 8],   // International Women's Day
        [5, 1],   // International Workers' Day
        [5, 9],   // Victory Day over Nazism in World War II
        [6, 28],  // Constitution Day
        [8, 24],  // Independence Day
        [10, 14], // Defenders Day
        [12, 25], // Catholic Christmas
    ];

    if (fixedHolidays.some(([month, day]) => date.month() + 1 === month && date.date() === day)) {
        return true;
    }

    const easterDate = easter(date.year());
    const easterMondayDate = easterDate.clone().add(1, 'day');
    const trinityDate = easterDate.clone().add(49, 'days');

    return date.isSame(easterDate, 'day') || 
           date.isSame(easterMondayDate, 'day') || 
           date.isSame(trinityDate, 'day');
}

function getNextSalaryDate(currentDate) {
    const salaryTime = { hour: 12, minute: 10 };
    let nextSalary = currentDate.clone().startOf('month').add(4, 'days').set(salaryTime);

    // If we're past this month's salary date, move to next month
    if (currentDate.isAfter(nextSalary)) {
        nextSalary.add(1, 'month');
    }

    // Adjust for weekends and holidays
    while (nextSalary.day() === 0 || nextSalary.day() === 6 || isUkrainianHoliday(nextSalary)) {
        nextSalary.subtract(1, 'day');
    }

    // Keep the time at 12:10
    nextSalary.set(salaryTime);

    return nextSalary;
}

function getSalaryMessage(now, nextSalary) {
    const difference = nextSalary.diff(now);
    const duration = moment.duration(difference);
    const days = Math.floor(duration.asDays());
    const hours = duration.hours();
    const minutes = duration.minutes();
    const seconds = duration.seconds();

    if (difference <= 0) {
        return "🎉🎊 It's Salary Day! 💰💸 Enjoy your well-earned money! 🥳🍾";
    } else if (days === 0) {
        return `⏰ Only ${hours}h ${minutes}m ${seconds}s left until Salary Day! 💰 Get ready to celebrate! 🎉`;
    } else if (days === 1) {
        return `⏰ Only 1 day and ${hours}h ${minutes}m left until Salary Day! 💰 Get ready to celebrate! 🎉`;
    } else if (days === 2) {
        return "🗓 2 days to go until Salary Day! 💼 The wait is almost over! 😊";
    } else if (days === 3) {
        return "📅 3 days remaining until Salary Day! 💰 It's getting closer! 🙌";
    } else {
        const countdownText = `${days}d ${hours}h ${minutes}m ${seconds}s`;
        const nextSalaryText = `Next Salary: ${nextSalary.format('MMMM D, YYYY [at] HH:mm')}`;
        return `⏳ Time until next salary: ${countdownText}\n📆 ${nextSalaryText}`;
    }
}

bot.command('when_salary', async (ctx) => {
    const now = moment().tz(KYIV_TZ);
    const nextSalary = getNextSalaryDate(now);
    const message = getSalaryMessage(now, nextSalary);
    await ctx.reply(message);
});

async function sendDailyNotification() {
    const now = moment().tz(KYIV_TZ);
    console.log('Generating notification for Kyiv time:', now.format());
    const nextSalary = getNextSalaryDate(now);
    const message = getSalaryMessage(now, nextSalary);
    console.log('Notification message:', message);

    try {
        await bot.telegram.sendMessage(CHAT_ID, message);
        console.log('Daily notification sent successfully to chat:', CHAT_ID);
        return true;
    } catch (error) {
        console.error('Failed to send daily notification:', error);
        throw error;
    }
}

exports.handler = async (event) => {
    console.log('Handler function called at:', new Date().toISOString());
    console.log('Event:', JSON.stringify(event));
    try {
        const body = JSON.parse(event.body);
        console.log('Parsed body:', body);

        if (body && body.trigger === 'daily_notification') {
            console.log('Daily notification trigger received');
            const now = moment().tz(KYIV_TZ);
            const today = now.format('YYYY-MM-DD');

            if (lastNotificationDate !== today) {
                console.log('Sending daily notification for date:', today);
                const success = await sendDailyNotification();
                if (success) {
                    lastNotificationDate = today;
                    return { 
                        statusCode: 200, 
                        body: JSON.stringify({ message: 'Daily notification sent successfully' })
                    };
                } else {
                    return { 
                        statusCode: 500, 
                        body: JSON.stringify({ error: 'Failed to send daily notification' })
                    };
                }
            } else {
                console.log('Notification already sent today:', today);
                return { 
                    statusCode: 200, 
                    body: JSON.stringify({ message: 'Notification already sent today' })
                };
            }
        }

        if (body && body.message) {
            console.log('Handling Telegram update');
            await bot.handleUpdate(body);
            return { 
                statusCode: 200, 
                body: JSON.stringify({ message: 'OK' })
            };
        }

        console.log('Unrecognized request');
        return { 
            statusCode: 400, 
            body: JSON.stringify({ error: 'Unrecognized request' })
        };
    } catch (e) {
        console.error('Error in handler:', e);
        return { 
            statusCode: 500, 
            body: JSON.stringify({ error: 'Internal server error' })
        };
    }
};