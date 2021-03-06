import Immutable, { fromJS } from 'immutable';
import reducer from 'reapp-reducer';
import Actions from 'actions';
import Request from 'lib/request';
import parseUrl from 'parseurl';
import { Promise } from 'bluebird';
import store from '../store';

// dont do stuff during view list animations
const waitForAnimation = Promise.promisify(require('reapp-ui/lib/waitForAnimation'));
const waitForViewList = res => waitForAnimation('viewList').then(() => res);

const req = new Request({ base: 'https://hacker-news.firebaseio.com/v0/' });
const loadedReducer = reducer.bind(null, 'LOADED');
const loadingStatus = {};

let page = 0;
const per = 10;

Actions.articlesHotLoad.listen(
  opts => loadHotArticlesOnce(opts)
);

Actions.articlesHotRefresh.listen(
  opts => loadHotArticles(opts)
);

Actions.articlesHotLoadMore.listen(
  () =>
    req.get('topstories.json')
      .then(waitForViewList)
      .then(insertNextArticles)
      .then(returnArticlesStore)
);

Actions.articleLoad.listen(
  id => {
    id = parseInt(id, 10);
    loadingStatus[id] = true;
    var article = store().getIn(['articles', id]);

    if (article && article.get('status') === 'LOADED')
      return Promise.resolve(article);
    else
      return req.get(`item/${id}.json`)
        .then(res => {
          res.parentId = res.id;
          return res;
        })
        .then(waitForViewList)
        .then(getAllKids)
        .then(loadedReducer)
        .then(waitForViewList)
        .then(insertArticle);
  }
);

Actions.articleUnload.listen(
  id => {
    id = parseInt(id, 10);
    loadingStatus[id] = false;
    store().setIn(['articles', id, 'data', 'kids'], null);
    store().setIn(['articles', id, 'status'], 'OK');
  }
);

function loadHotArticles(opts) {
  return req.get('topstories.json', opts)
    .then(waitForViewList)
    .then(articles => {
      const start = page * per;
      const hotArticles = articles.slice(0, start + per);
      store().set('hotArticles', hotArticles);
      insertArticles(hotArticles);
    })
    .then(returnArticlesStore);
}

var loadHotArticlesOnce = once(loadHotArticles);

function insertArticle(res, rej) {
  if (rej)
    return error(rej);

  var lastArticle;

  res.map(article => {
    // data transforms
    setHost(article);

    if (loadingStatus[article.id] !== false) {
      // save ref to last article and store
      lastArticle = fromJS(article);
      store().setIn(['articles', article.id], lastArticle);
    }
  });

  return lastArticle;
}

function setHost(article) {
  article.data.host = parseUrl({ url: article.data.url }).hostname;
}

function insertArticles(articles) {
  return Promise.all(
    articles.map(
      article => exists(article) ?
        article :
        req.get(`item/${article}.json`)
          .then(reducer)
          .then(insertArticle)
    )
  );
}

function insertNextArticles(articles) {
  page = page + 1;
  return insertArticles(articles);
}

function getAllKids(item) {
  var parentId = item.parentId;

  if (!loadingStatus[parentId])
    return Promise.resolve(false);

  var kids = item.kids;
  item.closed = false;

  if (!kids)
    return Promise.resolve(item);

  return (
    Promise.all(
      kids.map(kid => {
        return loadingStatus[parentId] ?
          req.get(`item/${kid}.json`).then(res => {
            res.parentId = parentId;
            return getAllKids(res);
          }) :
          null;
      })
    )
    .then(res => {
      item.kids = res;
      item.kidsLoaded = true;
      return item;
    })
  );
}

function returnArticlesStore() {
  return store().get('articles');
}

function exists(articleID) {
  return !!store().getIn(['articles', articleID]);
}

function error(err) {
  throw err;
}

function once(fn, context) {
  var result;

  return function() {
    if (fn) {
      result = fn.apply(context || this, arguments);
      fn = null;
    }

    return result;
  };
}