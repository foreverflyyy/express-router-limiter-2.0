const fs = require('fs');
const path = require('path');
const fsPromises = require("fs").promises;

let servicesConfig;
let usersConfig = new Map();

let black_list;
let white_list;
let next_methods;

const blackListPath = path.join(__dirname, "blackList.txt");
const whiteListPath = path.join(__dirname, "whiteList.txt");
const nextMethodsPath = path.join(__dirname, "nextMethods.txt");

let ddosTimeDefault;
let ddosCountDefault;

let intervalTime = null;
let minutesForCheckListsFiles = 15;

module.exports = (config) => {
    // Проверка пересечений значений файла и передаваемых
    (async () => {await firstCheckAndFillData(config);})();

    return async (req, res, next) => {
        try {
            await Promise
                .resolve(checkRequest(req, res, next))
                .catch(err => {throw new Error(err);})
        } catch (err) {
            console.log(err);
            throw new Error(err);
        }
    }
}

const firstCheckAndFillData = async (config) => {
    let {loadInterval, services, ...other} = config;

    if(loadInterval > 0) {
        intervalTime = loadInterval;
    }

    if(!services) { services = {}; }
    servicesConfig = {services, ...other};

    ddosTimeDefault = servicesConfig.defaultConfig.ddosTime
        ? servicesConfig.defaultConfig.ddosTime
        : 60 * 1000;
    ddosCountDefault = servicesConfig.defaultConfig.ddosCount
        ? servicesConfig.defaultConfig.ddosCount
        : 100;

    if (intervalTime > 0) {
        setInterval(() => {
            clearUsersConfig();
        }, intervalTime * 60 * 1000);
    }

    // Присвоение значений спискам ip и методам
    [black_list, white_list, next_methods] = [
        servicesConfig.black_list,
        servicesConfig.white_list,
        servicesConfig.next_methods
    ];

    // Актуализация данных в списках
    const black_list_from_file = await readRowsFromFile(blackListPath);
    let intersectedIps = findInteraction(black_list, black_list_from_file);
    await writeListToFile(blackListPath, intersectedIps.keys());

    const white_list_from_file = await readRowsFromFile(whiteListPath);
    intersectedIps = findInteraction(white_list, white_list_from_file);
    await writeListToFile(whiteListPath, intersectedIps.keys());

    const next_methods_from_file = await readRowsFromFile(nextMethodsPath);
    intersectedIps = findInteraction(next_methods, next_methods_from_file);
    await writeListToFile(nextMethodsPath, intersectedIps.keys());

    // Загрузить актуальные списки с файлов
    await loadLists();

    // Получение значений списков из файлов
    setInterval(async () => {
        await loadLists();
    }, minutesForCheckListsFiles * 60 * 1000);
}

// Удаляем апи, у которых закончилось время жизни
const clearUsersConfig = () => {
    console.log("check")
    console.log({usersConfig})
    for (const [userIp, value] of usersConfig.entries()) {
        let endTime = value.get("endTime");
        if(new Date().getTime() > endTime) {
            usersConfig.delete(userIp);
        }
    }
}

const readRowsFromFile = async (pathToFile) => {
    if (!fs.existsSync(pathToFile)) {
        await fsPromises.writeFile(pathToFile, "");
    }

    const rl = require('readline').createInterface({
        input: fs.createReadStream(pathToFile),
        crlfDelay: Infinity,
    });

    const writeData = new Map();
    for await (const line of rl) {
        writeData.set(line.trim(), 1);
    }
    return writeData;
}

const findInteraction = (firstMap, secondMap) => {
    const intersectedIps = new Map();
    for(const key of firstMap.keys()) {
        if(!secondMap.get(key)) {
            intersectedIps.set(key, 1);
        }
    }
    return intersectedIps;
}

const writeListToFile = async (pathToFile, ips) => {
    if (!fs.existsSync(pathToFile)) {
        await fsPromises.writeFile(pathToFile, "");
    }

    let writeData = "";
    for(const ip of ips)
        writeData += `${ip}\n`
    await fsPromises.appendFile(pathToFile, writeData);
}

const loadLists = async () => {
    white_list = await readRowsFromFile(whiteListPath);
    black_list = await readRowsFromFile(blackListPath);
    next_methods = await readRowsFromFile(nextMethodsPath);
}

const checkRequest = async (req, res, next) => {
    const methodType = req.method;
    if(next_methods.get(methodType)) {
        next();
        return;
    }

    const userIp = req.ip.match(/\d+/g).join("");
    if(white_list.get(userIp)) {
        next();
        return;
    }
    if(black_list.get(userIp)) {
        return res.status(429).json({success: false, data: "Please dont touch this service!"});
    }

    const partsUrl = req.url.split("/");
    const service = partsUrl[1];
    const method = partsUrl[2].split("?")[0];

    // Получение кол-ва запросов и времени лимита по методу
    const {maxAppeals, timeMs} = getNeedDataByUrl(servicesConfig, service, method);

    const keyHash = `${userIp}_${service}_${method}`
    const userSection = usersConfig.get(keyHash);

    if (userSection) {
        return await checkExistingIp({
            res,
            next,
            userSection,
            keyHash,
            dataByMethod: {maxAppeals, timeMs}
        });
    }

    return createNewIp({
        next: next,
        keyHash: keyHash,
        data: {timeMs, maxAppeals}
    });
}

const getNeedDataByUrl = (servicesConfig, service, method) => {
    // Сначала ставим дефолтные настройки
    let {maxAppeals, timeMs} = servicesConfig.defaultConfig;
    // Проверка есть ли секция нужного сервиса

    if(servicesConfig.services && servicesConfig.services[service]) {
        const serviceSection = servicesConfig.services[service];

        // Проверка есть ли секция нужного метода
        if(serviceSection.methods && serviceSection.methods[method]) {
            const methodSection = serviceSection.methods[method];
            // Если значения корректны то ставим настройки метода
            if(methodSection.timeMs && methodSection.maxAppeals >= 0) {
                timeMs = methodSection.timeMs;
                maxAppeals = methodSection.maxAppeals;
            }
        }
        // Если значения корректны то ставим настройки сервиса
        else if(serviceSection.timeMs && serviceSection.maxAppeals >= 0) {
            timeMs = serviceSection.timeMs;
            maxAppeals = serviceSection.maxAppeals;
        }
    }
    return {maxAppeals, timeMs};
}

const checkExistingIp = async ({res, next, userSection, dataByMethod, keyHash}) => {
    const userIp = keyHash.split("_")[0];
    const {timeMs, maxAppeals} = dataByMethod;

    let remainedAppeals = userSection.get("remainedAppeals");
    let endTime = userSection.get("endTime");

    // Если время подошло к концу
    if(new Date().getTime() >= endTime) {
        userSection.set("remainedAppeals", maxAppeals);
        userSection.set("endTime", new Date().getTime() + timeMs);
        remainedAppeals = maxAppeals;
    }

    // Если обращения ещё есть
    if(remainedAppeals > 0) {
        usersConfig.get(keyHash).set("remainedAppeals", remainedAppeals - 1);
        next();
        return;
    }

    // Если обращения закончились
    let ddosCount = userSection.get('ddosCount') ? userSection.get('ddosCount') : 0;
    ddosCount += 1
    userSection.set("ddosCount", ddosCount);

    let ddosTime = userSection.get("ddosTime");
    if (!ddosTime){
        const timeInSeconds = new Date().getTime();
        userSection.set("ddosTime", timeInSeconds);
        ddosTime = timeInSeconds;
    }

    const ddosTimeCheck = new Date().getTime() - ddosTime;
    if (ddosCount > ddosCountDefault && ddosTimeCheck < ddosTimeDefault){
        black_list.set(userIp, 1);
        await fsPromises.appendFile(blackListPath, `${userIp}\n`);
    }

    return res.status(429).json({success: false, data: "Превышено максимальное число запросов."});
}

const createNewIp = ({next, data, keyHash}) => {
    const {timeMs, maxAppeals} = data;

    if(!usersConfig.has(keyHash)) {
        usersConfig.set(keyHash, new Map());
    }

    usersConfig.get(keyHash).set("remainedAppeals", maxAppeals - 1);
    usersConfig.get(keyHash).set("endTime", new Date().getTime() + timeMs);

    if (intervalTime === null) {
        setTimeout(() => {
            usersConfig.delete(keyHash)
        }, timeMs)
    }

    next();
}
