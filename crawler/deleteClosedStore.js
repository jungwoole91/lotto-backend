const axios = require('axios');
const qs = require('qs');
const path = require('path');
var Iconv = require('iconv').Iconv;
var iconv = new Iconv('EUC-KR', 'UTF-8//TRANSLIT//IGNORE');
const url = `https://dhlottery.co.kr/store.do?method=sellerInfo645Result`;
const headers = {
  'Content-type': 'application/x-www-form-urlencoded; charset=UTF-8;',
};
const options = {
  headers: headers,
  responseType: 'arraybuffer',
  responseEncoding: 'binary'
};

const dotenv = require('dotenv');
dotenv.config({
  path: path.resolve(
    process.env.NODE_ENV == "production" ? ".env.prod" : ".env.dev"
  ),
});

const db = require('./models/index');

const SIDOArray = [
  '서울',
  '경기',
  '부산',
  '대구',
  '인천',
  '대전',
  '울산',
  '강원',
  '충북',
  '충남',
  '광주',
  '전북',
  '전남',
  '경북',
  '경남',
  '제주',
  '세종',
];

/** 동행복권 사이트 크롤링 후 삭제된 상점을 DB에 반영함 **/
const deleteClosedStore = async () => {
  for (const SIDO2 of SIDOArray) {
    await db.sequelize.sync();

    let startPage = 1;
    let isClosedStore = true;

    const param = qs.stringify({
      searchType: 3,
      nowPage: 1,
      sltSIDO2: SIDO2,
      sltGUGUN2: '',
    });

    // Step 1: 동행복권 사이트에서 마지막 페이지(totalPage)를 얻어옴.
    const response = await axios.post(url, param, options);
    const { data } = response;
    const result = toJson(iconv.convert(data).toString());
    let currentPage = result.totalPage;

    // Step 2: 마지막 페이지에서 첫번째 페이지까지 역순으로 데이터를 얻어옴. (폐점된 판매점 => 열린 판매점)
    while (startPage < currentPage  && isClosedStore) {
      const param = qs.stringify({
        searchType: 3,
        nowPage: currentPage,
        sltSIDO2: SIDO2,
        sltGUGUN2: '',
      });
      const response = await axios.post(url, param, options);
      const { data } = response;
      const result = toJson(iconv.convert(data).toString());
      const { arr } = result;
      const storeDataArray = arr;

      for (const store of storeDataArray.reverse()) {
        const {
          DEAL645,
          RTLRID
        } = store;

        parseInt(DEAL645) === 1 ? isClosedStore = false : isClosedStore = true;

        // Step 3: 현재 페이지에서 처음으로 열린 판매점이 검색된다면 이전 페이지로 이동 (페이지 -1)
        if (!isClosedStore) {
          break;
        } else {
          // Step 4: 폐점된 판매점 데이터중 DB에 현재 존재하는 판매점인지 찾음.
          const foundStore = await findStoreById(RTLRID); // 없으면 null 반환

          // Step 5: 만약 DB에 존재하는 판매점이라면 폐점된 판매점으로 DB Update (opend => false)
          if (foundStore) {
            await deleteClosedStoreFromDB(foundStore)
          }
        }
      }

      isClosedStore = true;
      currentPage--;
    }
  }

  console.log("폐점된 판매점 크롤링후 DB에서 삭제 작업 완료");
};

/**
 * 불필요한 문자열 제거후 JSON Object로 반환.
 * EUC-KR의 특수문자 왼쪽괄호[ ( ]  오른쪽괄호[ ) ] 를 UTF-8의 괄호로 처리.
 * @param data: 바이트 ArrayBuffer
 * @returns {any}: 왼쪽괄호와 오른쪽 괄호가 치환된 ArrayBuffer를 이용하여 JSON생성 후 반환
 */
const toJson = (data) => {
  return JSON.parse(
    data
      .replace(/\&\&\#35\;40\;/gi, '(')
      .replace(/\&\&\#35\;41\;/gi, ')')
      .replace(/\&amp\;/gi, '&')
  )
};

/**
 * 로또 판매점이 이미 DB 저장되었는지 여부 파악.
 * @param storeData: Axios로 얻어온 store 객체 (donhangid 파싱)
 * @returns {boolean}: DB 저장 여부
 */
const findStoreById = async (donghangId) => {
  try {
    const store = await db.Store.findOne({
      where: { donghangid: donghangId},
      attributes: ['id'],
    });

    if (store) {
      return store
    }

    return null;

  } catch (e) {
    console.log(e);
    return null;
  }
};


const deleteClosedStoreFromDB = async (Store) => {
  try {
    await Store.update({ opened: false });
    console.log('폐점된 판매점 업데이트');
    return Store;
  } catch (e) {
    console.log(e);
    return null;
  }
};

const IS_CRON_TEST = process.env.CRON_TEST === 'true'; // 크론 테스트인지 여부 확인
const IS_DEV = process.env.NODE_ENV === 'development'; // DEV 환경인지 확인

/** DEV Cron 테스트가 아니고, DEV환경일때만 파일에서 바로 크론작업 수행 **/
if (IS_CRON_TEST) {
  console.log('CRON 테스트')
} else if (IS_DEV) {
  deleteClosedStore();
}



module.exports.crawl = deleteClosedStore;
