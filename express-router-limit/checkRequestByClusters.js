const axios = require("axios");

const apiKey = "risKruto123";
const address = 'http://127.0.0.1:5000';
module.exports = (config) => {
    let firstSending = true;
    config.white_list = Object.fromEntries(config.white_list);
    config.black_list = Object.fromEntries(config.black_list);
    config.next_methods = Object.fromEntries(config.next_methods);

    return async (req, res, next) => {
        try {
            const response = await axios.post(address, {
                config,
                reqData: {
                    ip: req.ip,
                    url: req.url,
                    firstSending
                },
                apiKey: apiKey
            });
            if(response.data.success) {
                next();
                return;
            }
            return res.status(429).json({success: false, data: response.data.data});
        } catch (err) {
            console.log("Ошибка при отправке запроса в limiter.", err);
        } finally {
            firstSending = false;
        }
    }
}