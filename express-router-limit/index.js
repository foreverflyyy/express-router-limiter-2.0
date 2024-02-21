const rateLimit = (config) => {
    if(!checkConfig(config)) {
        throw new Error("Invalid config.");
    }

    const {haveClusters} = config;
    if(haveClusters) {
        return require("./checkRequestByClusters")(config);
    }
    return require("./checkRequest")(config);
}

const checkConfig = (config) => {
    const {
        microservice, defaultConfig,
        white_list, black_list, next_methods
    } = config;

    if (!config || !microservice || !defaultConfig) {
        return false;
    }
    const {timeMs, maxAppeals} = defaultConfig;
    if (typeof(timeMs) !== 'number' || !timeMs < 0
        || typeof(maxAppeals) !== 'number' || maxAppeals < 0) {
        return false;
    }

    config.white_list = checkAndConvertArrToDict(white_list);
    config.black_list = checkAndConvertArrToDict(black_list);
    config.next_methods = checkAndConvertArrToDict(next_methods);
    return true;
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

module.exports = rateLimit;

/*const rateLimit = require("express-router-limit");
const config = {
    microservice: "redirect",
    loadInterval: 0.2, // Интервал чистки пустых ip каждые 15 сек
    haveClusters: false,
    defaultConfig: {
        maxAppeals: 10,
        timeMs: 15 * 60 * 1000,
        ddosCount: 10,
        ddosTime: 10 * 1000,
    },
    white_list: ["2", "3"],
    black_list: ["82.219.149.192"],
    next_methods: ['OPTIONS'],
    services: {
        admin: {
            maxAppeals: 100,
            timeMs: 15 * 60 * 1000,
            methods: {
                projects: {
                    maxAppeals: 10,
                    timeMs: 0.1 * 60 * 1000
                }
            }
        },
        app: {
            maxAppeals: 10,
            timeMs: 15 * 60 * 1000,
            methods: {
                geturl: {
                    maxAppeals: 2,
                    timeMs: 15 * 60 * 1000,
                }
            }
        }
    }
}
router.use(rateLimit(config));*/