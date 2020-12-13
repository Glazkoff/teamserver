"use strict";
const express = require("express");
const serveStatic = require("serve-static");
const bodyParser = require("body-parser");
const Sequelize = require("sequelize");
const path = require("path");
const morgan = require("morgan");
const compression = require("compression");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");

const DBCONFIG = require("./db.config");
const JWTCONFIG = require("./secret.config");

const app = express();
let port = process.env.PORT || 3000;

// Сжатие gzip
app.use(compression());

// Настройка CORS
app.use(function (req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );
  res.header(
    "Access-Control-Allow-Methods",
    "GET, PATCH, PUT, POST, DELETE, OPTIONS"
  );
  next();
});

// Парсинг json - application/json
app.use(bodyParser.json());

// Парсинг запросов по типу: application/x-www-form-urlencoded
app.use(
  express.urlencoded({
    extended: true
  })
);

// Логирование запросов
app.use(morgan("common"));

// Запуск сервера на порте
const server = app
  .use("/", serveStatic(path.join(__dirname, "../dist")))
  .listen(port, () => {
    console.log(`server running on port ${port}`);
  });

// Создание соли для хеширования
const salt = bcrypt.genSaltSync(10);

// Создание подключения с БД
const sequelize = new Sequelize(DBCONFIG.DB, DBCONFIG.USER, DBCONFIG.PASSWORD, {
  dialect: "postgres",
  host: DBCONFIG.HOST
});

// МОДЕЛЬ: Users
const Users = sequelize.define("users", {
  user_id: {
    type: Sequelize.INTEGER,
    autoIncrement: true,
    primaryKey: true,
    allowNull: false
  },
  login: {
    type: Sequelize.STRING,
    allowNull: false
  },
  name: {
    type: Sequelize.STRING,
    allowNull: false
  },
  password: {
    type: Sequelize.STRING,
    allowNull: false
  },
  admin: {
    type: Sequelize.BOOLEAN,
    defaultValue: false
  }
});

// Модель: GameConfig
const GameConfig = sequelize.define("game_config", {
  config_id: {
    type: Sequelize.INTEGER,
    autoIncrement: true,
    primaryKey: true,
    allowNull: false
  },
  event_chance: {
    type: Sequelize.DECIMAL,
    allowNull: false
  }
});

// МОДЕЛЬ: Rooms
const Rooms = sequelize.define("rooms", {
  room_id: {
    type: Sequelize.INTEGER,
    autoIncrement: true,
    primaryKey: true,
    allowNull: false
  },
  owner_id: {
    type: Sequelize.INTEGER,
    allowNull: false
  },
  participants_id: {
    type: Sequelize.JSONB,
    allowNull: false
  },
  first_params: {
    type: Sequelize.JSONB,
    allowNull: false
  },
  completed: {
    type: Sequelize.BOOLEAN,
    defaultValue: false
  },
  is_start: {
    type: Sequelize.BOOLEAN,
    defaultValue: true,
    allowNull: false
  },
  budget_per_month: {
    type: Sequelize.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  users_steps_state: {
    type: Sequelize.ARRAY(Sequelize.JSONB),
    allowNull: true
    // defaultValue: []
  },
  current_month: {
    type: Sequelize.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  is_finished: {
    type: Sequelize.BOOLEAN,
    defaultValue: false
  },
  winners: {
    type: Sequelize.JSONB,
    allowNull: true
  }
});

// Модель: Reviews
const Reviews = sequelize.define("reviews", {
  review_id: {
    type: Sequelize.INTEGER,
    autoIncrement: true,
    primaryKey: true,
    allowNull: false
  },
  author_id: {
    type: Sequelize.INTEGER,
    allowNull: false
  },
  room_id: {
    type: Sequelize.INTEGER,
    allowNull: false
  },
  rating: {
    type: Sequelize.INTEGER,
    allowNull: false
  },
  comment: {
    type: Sequelize.TEXT,
    allowNull: false
  }
});

// Внешние ключи
Users.hasMany(Reviews, {
  onDelete: "cascade",
  foreignKey: "author_id",
  as: "reviews"
});
Reviews.belongsTo(Users, {
  foreignKey: "author_id",
  as: "user"
});

// Синхронизация таблиц с БД
sequelize
  .sync()
  .then(result => {
    trySetCards();
    trySetEvents();
    console.log("Подключено к БД");
  })
  .catch(err => console.log("Ошибка подключения к БД", err));

// Авторизация
app.post("/api/login", (req, res) => {
  console.log("LOGIN: ", req.body);
  if (!req.body.login || !req.body.password) {
    res.status(400).send({
      status: 400,
      message: "Пустой запрос!"
    });
  } else {
    Users.findOne({
      where: {
        login: req.body.login
      }
    })
      .then(user => {
        if (!user) {
          res.status(404).send({
            status: 404,
            message: "Неправильный логин или пароль!"
          });
        } else {
          bcrypt.compare(
            req.body.password,
            user.password,
            function (err, result) {
              if (err) {
                console.log("Ошибка расшифровки: ", err);
                res.status(500).send({
                  status: 500,
                  message: err
                });
              } else if (result) {
                console.log(result);
                const accessToken = jwt.sign(
                  {
                    id: user.user_id,
                    name: user.name,
                    admin: user.admin
                  },
                  JWTCONFIG.SECRET
                );
                res.send({
                  status: 202,
                  message: "Пользователь найден",
                  token: accessToken
                });
              } else {
                res.status(404).send({
                  status: 404,
                  message: "Неправильный логин или пароль"
                });
              }
            }
          );
        }
      })
      .catch(err => console.log(err));
  }
});

// Получение глобальной конфигурации
app.get("/api/admin/globalconfig", async (req, res) => {
  let lastConfig = await GameConfig.findOne({
    limit: 1,
    order: [["createdAt", "DESC"]]
  });
  let result = await GameConfig.create({
    event_chance: req.body.event_chance || lastConfig.event_chance
  });
  res.send({ config: result });
});

// Обновление глобальной конфигурации
app.post("/api/admin/globalconfig", async (req, res) => {
  let lastConfig = await GameConfig.findOne({
    limit: 1,
    order: [["createdAt", "DESC"]]
  });
  let result = await GameConfig.create({
    event_chance: req.body.event_chance || lastConfig.event_chance
  });
  res.send(result);
});

// Список всех отзывов
app.get("/api/reviewslist", async (req, res) => {
  try {
    let result = await Reviews.findAll({
      order: [["updatedAt", "DESC"]],
      include: [
        {
          model: Users,
          as: "user"
        }
      ]
    });
    res.send({ reviews: result });
  } catch (err) {
    console.log(err);
    res.status(500).send({
      status: 500,
      message: "Ошибка сервера!"
    });
  }
});

// Получение отзыва по id
app.get("/api/reviews/:id", async (req, res) => {
  try {
    let result = await Reviews.findOne({
      where: {
        review_id: req.params.id
      }
    });
    res.send(result);
  } catch (err) {
    console.log(err);
    res.status(500).send({
      status: 500,
      message: "Ошибка сервера!"
    });
  }
});

// Добавить отзыв
app.post("/api/addreview", async (req, res) => {
  try {
    let result = await Reviews.create({
      author_id: req.body.author_id,
      room_id: req.body.room_id,
      rating: req.body.rating,
      comment: req.body.comment
    });
    res.send(result);
  } catch (err) {
    console.log(err);
    res.status(500).send({
      status: 500,
      message: "Ошибка сервера!"
    });
  }
});

// Удалить отзыв
app.delete("/api/reviews/:id", async (req, res) => {
  try {
    let result = await Reviews.destroy({
      where: {
        review_id: req.params.id
      }
    });
    res.sendStatus(200);
  } catch (err) {
    console.log(err);
    res.status(500).send({
      status: 500,
      message: "Ошибка сервера!"
    });
  }
});

// Получение списка всех пользователей
app.get("/api/admin/users/list", async (req, res) => {
  let result = await Users.findAll({
    attributes: ["user_id", "login", "name", "createdAt"],
    order: [["updatedAt", "DESC"]]
  });
  res.send({ users: result });
});