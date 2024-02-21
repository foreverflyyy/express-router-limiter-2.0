const fs = require('fs');
const path = require('path');
const fsPromises = require("fs").promises;

let usersConfig = new Map();
let servicesConfig = new Map();
let serviceConfigSection;

let white_list;
let black_list;
let next_methods;

const blackListPath = path.join(__dirname, "blackList.txt");
const whiteListPath = path.join(__dirname, "whiteList.txt");
const nextMethodsPath = path.join(__dirname, "nextMethods.txt");

let minForCheckFiles = 0.1;
let defaultTimeForCheckUsersInterval = 0.1;

let flagLoadInterval = false;
const loadInterval = async () => {
    setInterval(async () => {
        await loadLists();
    }, minForCheckFiles * 60 * 1000);
}

module.exports = async (config, reqData, res) => {
    const {microservice} = config;
    const {firstSending} = reqData;
    if(!servicesConfig.get(microservice) || firstSending) {
        await checkAndFillServiceData(config);
    }

    if(!flagLoadInterval) {
        flagLoadInterval = true;
        await loadInterval();
    }

    try {
        return await checkRequest(reqData, res, microservice);
    } catch (err) {
        return res.json({success: false, data: err});
    }
}

const checkAndFillServiceData = async (config) => {
    const {microservice} = config;

    // Получение значения старого интервала, если оно было
    let oldIdUsersInterval;
    const oldSection = servicesConfig.get(microservice);
    if(oldSection) { oldIdUsersInterval = oldSection.oldIdUsersInterval; }

    config.white_list = checkAndConvertArrToDict(Object.keys(config.white_list));
    config.black_list = checkAndConvertArrToDict(Object.keys(config.black_list));
    config.next_methods = checkAndConvertArrToDict(Object.keys(config.next_methods));

    if(!config.services) { config.services = {}; }

    config.defaultConfig.ddosTime = config.defaultConfig.ddosTime ?? 60 * 1000;
    config.defaultConfig.ddosCount = config.defaultConfig.ddosCount ?? 100;

    servicesConfig.set(microservice, config);
    serviceConfigSection = config;

    // Актуализация данных в списках
    const black_list_from_file = await readRowsFromFile(blackListPath);
    let intersectedIps = findInteraction(serviceConfigSection.black_list, black_list_from_file);
    await writeListToFile(blackListPath, intersectedIps.keys());

    const white_list_from_file = await readRowsFromFile(whiteListPath);
    intersectedIps = findInteraction(serviceConfigSection.white_list, white_list_from_file);
    await writeListToFile(whiteListPath, intersectedIps.keys());

    const next_methods_from_file = await readRowsFromFile(nextMethodsPath);
    intersectedIps = findInteraction(serviceConfigSection.next_methods, next_methods_from_file);
    await writeListToFile(nextMethodsPath, intersectedIps.keys());

    // Загрузить актуальные списки с файлов
    await loadLists();

    const timeCheckUsersInterval = serviceConfigSection.loadInterval > 0
        ? serviceConfigSection.loadInterval
        : defaultTimeForCheckUsersInterval;

    // Убить старый интервал
    if(oldIdUsersInterval) {
        clearInterval(oldIdUsersInterval);
    }

    serviceConfigSection.oldIdUsersInterval = setInterval(() => {
        clearUsersConfig();
    }, timeCheckUsersInterval * 60 * 1000);
}

const checkAndConvertArrToDict = (arr) => {
    const newMap = new Map();
    if (arr && Array.isArray(arr)){
        for(const value of arr) {
            newMap.set(value, 1);
        }
    }
    return newMap;
}

// Удаляем апи, у которых закончилось время жизни
const clearUsersConfig = () => {
    for (const [userIp, value] of usersConfig.entries()) {
        let endTime = value.get("endTime");
        if(new Date().getTime() > endTime) {
            usersConfig.delete(userIp);
        }
    }
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

const checkRequest = async (req, res, microservice) => {
    const methodType = req.method;
    if(next_methods.get(methodType)) {
        return res.json({success: true, data: "Прошёл по методу."});
    }

    const userIp = req.ip.match(/\d+/g).join("");
    if(white_list.get(userIp)) {
        return res.json({success: true, data: "Прошёл по белому билету."});
    }
    if(black_list.get(userIp)) {
        return res.json({success: false, data: "Please dont touch this service!"});
    }

    const partsUrl = req.url.split("/");
    const service = partsUrl[1];
    const method = partsUrl[2].split("?")[0];

    // Получение кол-ва запросов и времени лимита по методу
    serviceConfigSection = servicesConfig.get(microservice);
    const {maxAppeals, timeMs} = getNeedDataByUrl(service, method);

    const keyHash = `${userIp}_${microservice}_${service}_${method}`
    const userSection = usersConfig.get(keyHash);

    if (userSection) {
        return await checkExistingIp({
            res,
            userSection,
            keyHash,
            dataByMethod: {maxAppeals, timeMs}
        });
    }

    return createNewIp({
        res,
        keyHash,
        data: {timeMs, maxAppeals}
    });
}

const getNeedDataByUrl = (service, method) => {
    // Сначала ставим дефолтные настройки
    let {maxAppeals, timeMs} = serviceConfigSection.defaultConfig;
    // Проверка есть ли секция нужного сервиса

    if(serviceConfigSection.services && serviceConfigSection.services[service]) {
        const serviceSection = serviceConfigSection.services[service];

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

const checkExistingIp = async ({res, userSection, dataByMethod, keyHash}) => {
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
        return res.json({success: true, data: "Запросы ещё есть."});
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
    if (ddosCount > serviceConfigSection.defaultConfig.ddosCount
        && ddosTimeCheck < serviceConfigSection.defaultConfig.ddosTime)
    {
        black_list.set(userIp, 1);
        await fsPromises.appendFile(blackListPath, `${userIp}\n`);
    }

    return res.json({success: false, data: "Превышено максимальное число запросов."});
}

const createNewIp = ({res, data, keyHash}) => {
    const {timeMs, maxAppeals} = data;

    if(!usersConfig.has(keyHash)) {
        usersConfig.set(keyHash, new Map());
    }

    usersConfig.get(keyHash).set("remainedAppeals", maxAppeals - 1);
    usersConfig.get(keyHash).set("endTime", new Date().getTime() + timeMs);

    return res.json({success: true, data: "Пользователь создался."});
}