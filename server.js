// Babel ES6/JSX Compiler
require('babel-register');

var path = require('path');
var express = require('express');
var bodyParser = require('body-parser');
var compression = require('compression');
var favicon = require('serve-favicon');
var logger = require('morgan');
var async = require('async');
var colors = require('colors');
var mongoose = require('mongoose');
var request = require('request');
var React = require('react');
var ReactDOM = require('react-dom/server');
var Router = require('react-router');
var swig = require('swig');
var _ = require('underscore');
var Twit = require('twit');
var moment = require('moment');

var config = require('./config');
var routes = require('./app/routes');
var TwitterStats = require('./models/stats');

var app = express();
var newTweets = 0;

var TwitBot = new Twit({
  consumer_key: config.TWITTER_CONSUMER_KEY,
  consumer_secret: config.TWITTER_CONSUMER_SECRET,
  access_token: config.TWITTER_ACCESS_TOKEN,
  access_token_secret: config.TWITTER_ACCESS_TOKEN_SECRET
});

mongoose.connect(config.database);
mongoose.connection.on('error', function() {
  console.info('Error: Could not connect to MongoDB. Did you forget to run `mongod`?');
});

app.set('port', process.env.PORT || 3000);
app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
  extended: false
}));
app.use(express.static(path.join(__dirname, 'public')));


/**
 * GET /api/getTweets
 * gets tweets 
 */
app.get('/api/getTweets', function(req, res, next) {

  newTweets = 0;
  TwitBot.get('statuses/user_timeline', {
      screen_name: 'RT_Himachal',
      count: 30
    },
    function(err, data, response) {
      if (err) return next(err);
      var created = moment(new Date(data[0].created_at)).format('MM/DD/YYYY');
      retweetMissedTweets(created);
      res.send(data);
    });
});


app.use(function(req, res) {
  Router.match({
    routes: routes.default,
    location: req.url
  }, function(err, redirectLocation, renderProps) {
    if (err) {
      res.status(500).send(err.message)
    } else if (redirectLocation) {
      res.status(302).redirect(redirectLocation.pathname + redirectLocation.search)
    } else if (renderProps) {
      var html = ReactDOM.renderToString(React.createElement(Router.RoutingContext, renderProps));
      var page = swig.renderFile('views/index.html', {
        html: html
      });
      res.status(200).send(page);
    } else {
      res.status(404).send('Page Not Found')
    }
  });
});

app.use(function(err, req, res, next) {
  console.log(err.stack.red);
  res.status(err.status || 500);
  res.send({
    message: err.message
  });
});



/**
 * Socket.io stuff.
 */
var server = require('http').createServer(app);
var io = require('socket.io')(server);
var onlineUsers = 0;


io.sockets.on('connection', function(socket) {
  onlineUsers++;
  getNewTweets();
  io.sockets.emit('onlineUsers', {
    onlineUsers: onlineUsers
  });

  socket.on('disconnect', function() {
    onlineUsers--;
    io.sockets.emit('onlineUsers', {
      onlineUsers: onlineUsers
    });
  });

});

server.listen(app.get('port'), function() {
  console.log('Express server listening on port ' + app.get('port'));
});

/** 
 * attach a listener to new tweets with hashtags to watch 
 */
function getNewTweets() {
  var WATCH_HASHTAGS = '#himachal, #himachalpradesh, #Himachal, #HimachalPradesh, #हिमाचल';
  /* 
   *  
   * filter the twitter public stream by the hashtags. 
   */
  var stream = TwitBot.stream('statuses/filter', {
    track: WATCH_HASHTAGS
  })

  stream.on('tweet', function(tweet) {
    TwitBot.post('statuses/retweet/:id', {
      id: tweet.id_str
    }, function(error, data, response) {
      if (error) {
        console.warn("Error:" + error);
        return;
      }
      // increase new tweets count and emit new event
      newTweets++;
      saveTweetEntities(tweet);
      io.sockets.emit('newTweet', {
        newTweets: newTweets
      });
    });
  });
}

/**
 * Save tweet entities for the stats
 */
function saveTweetEntities(tweet) {
  var twitterStats = new TwitterStats({
    tweetId: tweet.id_str,
    user: tweet.retweeteduser,
    hashtags: tweet.entities.hashtags,
    urls: tweet.entities.urls,
    created_at: tweet.created_at,
    mentions: tweet.entities.mentions
  });

  twitterStats.save(function(err) {
    if (err) {
      console.warn("Error:" + err);
      return;
    }     
  });
}

/***
 * get tweets for all hashtags 
 */
function retweetMissedTweets(created) {

  getAndRetweet('#himachal', created);

  getAndRetweet('#himachalpradesh', created);

  getAndRetweet('#Himachal', created);

  getAndRetweet('#HimachalPradesh', created);

  getAndRetweet('#हिमाचल', created);

}

/**
 * get tweets and retweet
 */
function getAndRetweet(hashtag, created) {
 
  TwitBot.get('search/tweets', {
    q: hashtag + 'since:' + created,
    count: 100
  }, function(err, tweets, response) {

    _.each(tweets.statuses, function(tweet) {
      saveTweetEntities(tweet);
      
      TwitBot.post('statuses/retweet/:id', {
        id: tweet.id_str
      }, function(error, data, response) {
        if (error) {
          console.warn("Error:" + error);
          return;
        }
        
      });
    });
  });
}