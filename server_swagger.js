var express     = require('express');
var session = require('client-sessions');
var app         = express();
var client = require('./connection.js');  
var request = require('request');
var bodyParser  = require('body-parser');
var morgan      = require('morgan');
var mongoose    = require('mongoose');
var passport	= require('passport');
var config      = require('./config/database'); // get db config file
var User        = require('./app/models/user'); // get the mongoose model
var port        = process.env.PORT || 8080;
var jwt         = require('jwt-simple');
var yahooFinance = require('yahoo-finance');
var googleFinance = require('google-finance');
var util = require('util');
var _ = require('lodash');
var symbol = "YHOO";
var FIELDS = _.flatten([
  // Pricing
  ['a', 'b', 'b2', 'b3', 'p', 'o'],
  // Dividends
  ['y', 'd', 'r1', 'q'],
  // Date
  ['c1', 'c', 'c6', 'k2', 'p2', 'd1', 'd2', 't1'],
  // Averages
  ['c8', 'c3', 'g', 'h', 'k1', 'l', 'l1', 't8', 'm5', 'm6', 'm7', 'm8', 'm3', 'm4'],
  // Misc
  ['w1', 'w4', 'p1', 'm', 'm2', 'g1', 'g3', 'g4', 'g5', 'g6'],
  // 52 Week Pricing
  ['k', 'j', 'j5', 'k4', 'j6', 'k5', 'w'],
  // System Info
  ['i', 'j1', 'j3', 'f6', 'n', 'n4', 's1', 'x', 'j2'],
  // Volume
  ['v', 'a5', 'b6', 'k3', 'a2'],
  // Ratio
  ['e', 'e7', 'e8', 'e9', 'b4', 'j4', 'p5', 'p6', 'r', 'r2', 'r5', 'r6', 'r7', 's7'],
  // Misc
  ['t7', 't6', 'i5', 'l2', 'l3', 'v1', 'v7', 's6', 'e1']
]);

var url = 'http://query.yahooapis.com/v1/public/yql?q=select * from yahoo.finance.quotes where symbol IN (';
var startDateConstant = 'and startDate =';
var endDateConstant = 'and endDate =';
var remainingURL = ')&format=json&env=http://datatables.org/alltables.env';

// get our request parameters
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

app.use(session({
  cookieName: 'session', // cookie name dictates the key name added to the request object
  secret: '1234qwerty{}[]()', // should be a large unguessable string
  duration: 24 * 60 * 60 * 1000, // how long the session will stay valid in ms
  cookie: {
    path: '/api', // cookie will only be sent to requests under '/api'
    maxAge: 60000, // duration of the cookie in milliseconds, defaults to duration above
    ephemeral: false, // when true, cookie expires when the browser closes
    httpOnly: true, // when true, cookie is not accessible from javascript
    secure: false // when true, cookie will only be sent over SSL. use key 'secureProxy' instead if you handle SSL not in your node process
  }
}));

// log to console
app.use(morgan('dev'));

// Use the passport package in our application
app.use(passport.initialize());

app.use(function(req, res, next) {
  if (req.session && req.session.user) {
    User.findOne({ name: req.body.name }, function(err, user) {
      if (user) {
        req.user = user;
        delete req.user.password; // delete the password from the session
        req.session.user = user;  //refresh the session value
        res.locals.user = user;
      }
      // finishing processing the middleware and run the route
      next();
    });
  } else {
    next();
  }
});

// demo Route (GET http://localhost:8080)
app.get('/', function(req, res) {
  res.send('Hello! The API is at http://localhost:' + port + '/api');
});

// connect to database
mongoose.connect(config.database);

// pass passport for configuration
require('./config/passport')(passport);

// bundle our routes
var apiRoutes = express.Router();

// create a new user account (POST http://localhost:8080/api/signup)
apiRoutes.post('/signup', function(req, res) {
  if (!req.body.name || !req.body.password) {
    res.json({success: false, msg: 'Please pass name and password.'});
  } else {
    var newUser = new User({
      name: req.body.name,
      password: req.body.password
    });
    // save the user
    newUser.save(function(err) {
      if (err) {
        return res.json({success: false, msg: 'Username already exists.'});
      }
      res.json({success: true, msg: 'Successful created new user.'});
    });
  }
});


// route to authenticate a user (POST http://localhost:8080/api/authenticate)
apiRoutes.post('/authenticate', function(req, res) {
  User.findOne({
    name: req.body.name
  }, function(err, user) {
    if (err) throw err;

    if (!user) {
      res.send({success: false, msg: 'Authentication failed. User not found.'});
      req.session.reset();
      res.redirect('/api/signup');
    } else {
      // check if password matches
      user.comparePassword(req.body.password, function (err, isMatch) {
        if (isMatch && !err) {
          // if user is found and password is right create a token
          var token = jwt.encode(user, config.secret);

          // return the information including token as JSON
//          res.json({success: true, token: 'JWT ' + token});
          res.setHeader('Authorization','JWT ' + token);
          req.session.user = user;
        //  next();
        } else {
          res.send({success: false, msg: 'Authentication failed. Wrong password.'});
      //    req.session.reset();
        res.redirect('/api/signup');
        }
      });
    }
  });
});


 // route to a restricted info (GET http://localhost:8080/api/memberinfo)
apiRoutes.get('/memberinfo', passport.authenticate('jwt', { session: false}), function(req, res) {
  var token = getToken(req.headers);
  if (token) {
    var decoded = jwt.decode(token, config.secret);
    User.findOne({
      name: decoded.name
    }, function(err, user) {
        if (err) throw err;

        if (!user) {
          return res.status(403).send({success: false, msg: 'Authentication failed. User not found.'});
          req.session.reset();
          res.redirect('/signup');
        } else {
//          res.json({success: true, msg: 'Welcome in the member area ' + user.name + '!'});
            req.session.user = user;
            //res.locals.user = user;
//          next();
        }
    });
  } else {
    return res.status(403).send({success: false, msg: 'No token provided.'});
  }
});

// create a new user account (POST http://localhost:8080/api/logout)
apiRoutes.post('/logout', function(req, res) {
  if (req.session && req.session.user) {
    req.session.reset();
}
else {
  console.log("No session exists");
}
});

getToken = function (headers) {
  if (headers && headers.authorization) {
    var parted = headers.authorization.split(' ');
    if (parted.length === 2) {
      return parted[1];
    } else {
      return null;
    }
  } else {
    return null;
  }
};

//Get shares data using yahoo REST API for Quotes data
// yahoo REST API : http://query.yahooapis.com/v1/public/yql?q=select * from yahoo.finance.quotes where symbol IN ("YHOO","GOOGL","TWTR","AAPL")&format=json&env=http://datatables.org/alltables.env
 apiRoutes.post('/yahooRESTQuotesData', function(req, res) {
 request({
    url: url+req.query.symbolList+remainingURL,
    method: "GET",
    json: true
//  body: JSON.stringify(requestData)
    }, function (error, resp, body) {
if (error) { throw error; }
if (!error && res.statusCode == 200) {
	res.send(body);}});
 });

 //Get shares data using yahoo REST API for historical data
 // yahoo REST API : http://query.yahooapis.com/v1/public/yql?q=select * from yahoo.finance.quotes where symbol IN ("YHOO","GOOGL","TWTR","AAPL")&format=json&env=http://datatables.org/alltables.env
  apiRoutes.post('/yahooRESTHistoricalData', function(req, res) {
  request({
     url: url+req.query.symbolList+remainingURL,
     method: "GET",
     json: true
 //  body: JSON.stringify(requestData)
     }, function (error, resp, body) {
 if (error) { throw error; }
 if (!error && res.statusCode == 200) {
 	res.send(body);}});
  });



// Get shares data using yahoo-finance API (POST http://localhost:8080/api/yahooHistoricalData)
apiRoutes.post('/yahooHistoricalData', function(req, res) {
  if (!req.body.symbolList || !req.body.startDate || !req.body.endDate) {

//	  var symbol = "YHOO";	  //getList(req.body.symbolList);
// Yahoo- finance
//1. Download Historical Data (multiple symbols)
// console.log(req.query.symbolList);
yahooFinance.historical({
  symbols: ['YHOO'],//req.query.symbolList,
  from: req.query.startDate,
  to: req.query.endDate,
  period:'d'
  // period: 'd'  // 'd' (daily), 'w' (weekly), 'm' (monthly), 'v' (dividends only)
}, function (err, historical) {
  if (err) { throw err; }
  _.each(historical, function (quotes, symbols) {
 //   console.log(util.format(      '=== %s (%d) ===',      symbols,      quotes.length    ).cyan);
    if (quotes[0]) {
//		var quotesData={};
//for (var i = 0; i < quotes.length; i++) {   // console.log(quotes[i]);    // more statements
//quotesData += JSON.parse(quotes[i]);
//res.status(200).json({data: quotes[i]});
//}
  //   console.log(        '%s\n...\n%s',        JSON.stringify(quotes[0], null, 2),        JSON.stringify(quotes[quotes.length - 1], null, 2)      );
// log("json: "+quotes + "josnstring: "+JSON.stringify(quotes));
  res.status(200).json({data:quotes});
	//res.status(200).json({data: quotes[0], data2: quotes[quotes.length - 1]});
    } else {
  //    console.log('N/A');
	  res.status(202).send({msg: 'data not available'});
    }
});
});
}});


// Get shares data using yahoo-finance API (POST http://localhost:8080/api/yahooSnapshotData)
apiRoutes.post('/yahooSnapshotData', function(req, res) {
  if (!req.body.symbolList) {

//	  var symbol = var symbol = "YHOO";	  //getList(req.body.symbolList);
//	  var fieldList = 's';	  //getList(req.body.fields)
// 2. Download Snapshot Data (multiple symbols)

yahooFinance.snapshot({
  fields: FIELDS, //[req.query.fieldList],  // ex: ['s', 'n', 'd1', 'l1', 'y', 'r']
  symbols: ['YHOO']//[req.query.symbolList],
}, function (err, snapshot) {
  if (err) { throw err; }
  _.each(snapshot, function (quotes, snapshot) {
  //  console.log(util.format(      '=== %s (%d) ===',      symbol,      quotes.length    ).cyan);
    //  console.log(        '%s\n...\n%s',        JSON.stringify(quotes[0], null, 2),        JSON.stringify(quotes[quotes.length - 1], null, 2)      );
	res.status(200).json({data: quotes});
  });
});
}});

// Google - finance

apiRoutes.post('/googleCompanyNews', function(req, res) {
  if (!req.body.symbolList) {

 //var SYMBOLS = [  'NASDAQ:AAPL',  'NYSE:IBM',  'NYSE:TWTR'];
 googleFinance.companyNews({
  symbols: ['IBM']//[req.query.symbolLis]
}, function (err, result) {
  if (err) { throw err; }
  _.each(result, function (news, symbols) {
//    console.log(util.format(      '=== %s (%d) ===',      symbol,      news.length    ).cyan);
    if (news[0]) {
//      console.log(        '%s\n...\n%s',        JSON.stringify(news[0], null, 2),        JSON.stringify(news[news.length - 1], null, 2)      );
	  res.status(200).json({data: news});
    } else {
//      console.log('N/A');
	  res.status(203).send({msg: 'data not available'});
    }
  });
});
}});

// Get shares data using yahoo-finance API (POST http://localhost:8080/api/googleHistoricData)

apiRoutes.post('/googleHistoricData', function(req, res) {
  if (!req.body.symbolList || !req.body.startDate || !req.body.endDate) {

googleFinance.historical({
  symbols: ['IBM'],//[req.query.symbolLis],
  from: req.query.startDate,
  to: req.query.endDate
}, function (err, result) {
  if (err) { throw err; }
  _.each(result, function (quotes, symbols) {
//    console.log(util.format(      '=== %s (%d) ===',      symbol,      quotes.length    ).cyan);
    if (quotes[0]) {
//      console.log(        '%s\n...\n%s',        JSON.stringify(quotes[0], null, 2),        JSON.stringify(quotes[quotes.length - 1], null, 2)      );
	  res.status(200).json({data: quotes});
    } else {
  //    console.log('N/A');
	  res.status(203).send({msg: 'data not available'});
    }
  });
});
}});
// connect the api routes under /api/*
app.use('/api', apiRoutes);

// Start the server
app.listen(port);
console.log('There will be dragons: http://localhost:' + port);
