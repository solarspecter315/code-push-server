import { Op } from 'sequelize';
import _ from 'lodash';
import moment from 'moment';
import { UserTokens } from '../models/user_tokens';
import { Users } from '../models/users';
import { config } from '../core/config';
import { AppError, Unauthorized } from './app-error';
import { parseToken, md5 } from '../core/utils/security';

var middleware = module.exports;

var checkAuthToken = function (authToken) {
    var objToken = parseToken(authToken);
    return Users.findOne({
        where: { identical: objToken.identical },
    })
        .then((users) => {
            if (_.isEmpty(users)) {
                throw new Unauthorized();
            }
            return UserTokens.findOne({
                where: {
                    tokens: authToken,
                    uid: users.id,
                    expires_at: {
                        [Op.gt]: moment().format('YYYY-MM-DD HH:mm:ss'),
                    },
                },
            }).then((tokenInfo) => {
                if (_.isEmpty(tokenInfo)) {
                    throw new Unauthorized();
                }
                return users;
            });
        })
        .then((users) => {
            return users;
        });
};

var checkAccessToken = function (accessToken) {
    return new Promise((resolve, reject) => {
        if (_.isEmpty(accessToken)) {
            return reject(new Unauthorized());
        }
        var tokenSecret = _.get(config, 'jwt.tokenSecret');
        var jwt = require('jsonwebtoken');
        try {
            var authData = jwt.verify(accessToken, tokenSecret);
        } catch (e) {
            return reject(new Unauthorized());
        }
        var uid = _.get(authData, 'uid', null);
        var hash = _.get(authData, 'hash', null);
        if (parseInt(uid) > 0) {
            return Users.findOne({
                where: { id: uid },
            })
                .then((users) => {
                    if (_.isEmpty(users)) {
                        throw new Unauthorized();
                    }
                    if (!_.eq(hash, md5(users.get('ack_code')))) {
                        throw new Unauthorized();
                    }
                    resolve(users);
                })
                .catch((e) => {
                    reject(e);
                });
        } else {
            reject(new Unauthorized());
        }
    });
};

middleware.checkToken = function (req, res, next) {
    var authArr = _.split(req.get('Authorization'), ' ');
    var authType = 1;
    var authToken = null;
    if (_.eq(authArr[0], 'Bearer')) {
        authToken = authArr[1]; //Bearer
        if (authToken && authToken.length > 64) {
            authType = 2;
        } else {
            authType = 1;
        }
    } else if (_.eq(authArr[0], 'Basic')) {
        authType = 2;
        var b = Buffer.from(authArr[1], 'base64');
        var user = _.split(b.toString(), ':');
        authToken = _.get(user, '1');
    }
    if (authToken && authType == 1) {
        checkAuthToken(authToken)
            .then((users) => {
                req.users = users;
                next();
                return users;
            })
            .catch((e) => {
                if (e instanceof AppError) {
                    res.status(e.status || 404).send(e.message);
                } else {
                    next(e);
                }
            });
    } else if (authToken && authType == 2) {
        checkAccessToken(authToken)
            .then((users) => {
                req.users = users;
                next();
                return users;
            })
            .catch((e) => {
                if (e instanceof AppError) {
                    res.status(e.status || 404).send(e.message);
                } else {
                    next(e);
                }
            });
    } else {
        res.send(new Unauthorized(`Auth type not supported.`));
    }
};
