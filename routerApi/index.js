const Express = require('express')
const app = new Express()

app.use(Express.json());

const PORT = 5000;

const secret = "risKruto123";
app.post("/", async (req, res, next) => {
    try {
        const {config, reqData, apiKey} = req.body;
        if(apiKey !== secret || !reqData || !reqData.ip || !reqData.url || !config || !config.microservice){
            return res.json({success: false, data: "Неправильно переданы аргументы."})
        }

        return await require("./checkRequest")(config, reqData, res);
    } catch(err) {
        return res.json({success: false, data: err});
    }
});

app.listen(PORT, () => {console.log("Listening port: ", PORT)});