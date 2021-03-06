const path = require('path');
const dotenv = require('dotenv');
dotenv.config({
  path: path.resolve(
    process.env.NODE_ENV == "production" ? ".env.prod" : ".env.dev"
  ),
});

const puppeteer = require('puppeteer');
const db = require('./models/index');
const IS_CRON_TEST = process.env.CRON_TEST === 'true'; // 크론 테스트인지 여부 확인
const IS_DEV = process.env.NODE_ENV === 'development'; // DEV 환경인지 확인

/** 로또 지옥 사이트 크롤링후 당첨 상점을 DB로 삽입 **/
const insertStoreWinning = async (isLatestRoundCrawl) => {
  try {
    await db.sequelize.sync();

    /** Production 환경(EC2) 일때와 개발환경(Mac)일때 browser 옵션 분리 **/
    let browser = null;
    if (IS_DEV) {
        browser = await puppeteer.launch({
        headless: true, // 실제 화면에 보여줄지 말지 결정
        // args: ['--window-size=1920, 1080', '--disable-notifications', '--no-sandbox']
      });
    } else {
      browser = await puppeteer.launch({
        ignoreDefaultArgs: ["--disable-extensions"],
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
    }

    const page = await browser.newPage();
    // page.on("console", (consoleObj) => console.log(consoleObj.text()));
    await page.addScriptTag({ url: 'https://code.jquery.com/jquery-3.2.1.min.js' });
    await page.setViewport({
      width: 1080,
      height: 1080,
    });


    await page.goto(`https://lottohell.com/winstores/`);
    await page.addScriptTag({ url: 'https://code.jquery.com/jquery-3.2.1.min.js' });
    await page.waitFor(1000);

    const latestRound = await page.evaluate(() => {
      const headerText = $($('.card').find('.card-header')[0]).text().trim();
      const round = parseInt(headerText.substring(headerText.indexOf(' ') + 1, headerText.indexOf('회')));
      return round;
    });

    /** 1등 당첨 판매점 조회 **/
    const startRound = isLatestRoundCrawl? latestRound : 949;
    const endRound = isLatestRoundCrawl? latestRound : 262;

    // Step 1: 각 회차별 1등 판매정보 첫 페이지로 이동 (시작회차 => 마지막 회차)
    for (let round = startRound; round >= endRound; round--) {
      await page.goto(`https://lottohell.com/winstores/?page=1&round=${round}&rank=1`);
      await page.waitFor(1000);

      // Step 2: 각 회차별 판매정보 페이지의 제일 끝 페이지에 대한 정보를 확인
      const totalPage = await page.evaluate(() => {
        const getTotalPage = (str) => {
          const removeBlankStr = str.replace(/ +/g, "");
          if (!removeBlankStr) {
            return -1
          }

          return parseInt(removeBlankStr.substr(removeBlankStr.indexOf('/') + 1, 1), 10);
        };
        return getTotalPage($('.current').text().trim());
      });

      // Step 3: 선택된 회차의 시작페이지부터 끝 페이지까지 페이지를 이동하며 당첨 판매점 데이터 확인
      for (let current = 1; current <= totalPage; current++) {
        await page.goto(`https://lottohell.com/winstores/?page=${current}&round=${round}&rank=1`);
        await page.addScriptTag({ url: 'https://code.jquery.com/jquery-3.2.1.min.js' });
        await page.waitFor(1000);

        // Step 4: 각 페이지별로 당점판매점 데이터를 얻어와서 배열에 저장.
        const winningDataArray = await page.evaluate(() => {
          let selection, storeName, address;
          const rank = 1;
          const result = [];
          const removeBlank = (str) => {
            return str.trim().replace(/ +/g, " ")
          };
          const checkSelection = (str) => {
            try {
              const leftBraceIndex = str.indexOf('(');
              const rightBraceIndex = str.indexOf(')');
              return str.substring(leftBraceIndex + 1, rightBraceIndex);
            } catch (e) {
              return e;
            }
          };

          for (const item of $('.card.border-gold')) {
            selection = checkSelection(removeBlank($(item).find('.card-header').text()));
            storeName = removeBlank($(item).find('.card-body .text-primary').text());
            address = removeBlank($(item).find('.card-body .card-text').text());

            result.push({
              rank, // 등수
              selection, // 자동 | 수동
              storeName, // 판매점 이름
              address, // 판매점 주소
            })
          }

          return result;
        });

        // Step 5: 배열을 순회하면서 당첨 판매점 데이터를 DB에 삽입
        for (const winning of winningDataArray) {
          winning.round = round;
          await insertWinning(winning);
          await console.log(winning)
        }
      }
    }

    /** 2등 당첨 판매점 조회 **/

    // Step 1: 각 회차별 2등 판매정보 첫 페이지로 이동 (시작회차 => 마지막 회차)
    for (let round = startRound; round >= endRound; round--) {
      await page.goto(`https://lottohell.com/winstores/?page=1&round=${round}&rank=2`);
      await page.waitFor(1000);

      // Step 2: 각 회차별 판매정보 페이지의 제일 끝 페이지에 대한 정보를 확인
      const totalPage = await page.evaluate(() => {
        const getTotalPage = (str) => {
          const removeBlankStr = str.replace(/ +/g, "");
          if (!removeBlankStr) {
            return -1
          }
          return parseInt(removeBlankStr.substr(removeBlankStr.indexOf('/') + 1, 1), 10);
        };
        return getTotalPage($('.current').text().trim());
      });

      // Step 3: 선택된 회차의 시작페이지부터 끝 페이지까지 페이지를 이동하며 당첨 판매점 데이터 확인
      for (let current = 1; current <= totalPage; current++) {
        await page.goto(`https://lottohell.com/winstores/?page=${current}&round=${round}&rank=2`);
        await page.addScriptTag({ url: 'https://code.jquery.com/jquery-3.2.1.min.js' });
        await page.waitFor(1000);

        // Step 4: 각 페이지별로 당점판매점 데이터를 얻어와서 배열에 저장.
        const winningDataArray = await page.evaluate(() => {
          let storeName, address, selection = null;
          const rank = 2;
          const result = [];
          const removeBlank = (str) => {
            return str.trim().replace(/ +/g, " ")
          };

          for (const item of $('.card.border-silver')) {
            storeName = removeBlank($(item).find('.card-body .text-primary').text());
            address = removeBlank($(item).find('.card-body .card-text').text());

            result.push({
              rank,
              selection,
              storeName,
              address,
            })
          }

          return result;
        });

        // Step 5: 배열을 순회하면서 당첨 판매점 데이터를 DB에 삽입
        for (const winning of winningDataArray) {
          winning.round = round;
          await insertWinning(winning);
          await console.log(winning)
        }
      }
    }

    console.log(`당첨 판매점 크롤러 작업 완료`);
    await page.close();
    await browser.close();
  } catch (e) {
    console.error(e);
  }
};

/**
 * 주소를 파싱해서 region에 대한 데이터를 얻어옴.
 * 만약 region2에 2단어 이상의 주소가 포함되 있을때의 예외처리를 진행.
 * @param address:
 * @returns {*}
 */
const devideRegion = (address) => {
  const address_words = address.split(' ');

  if (
    address.indexOf('고양시 덕양구') > -1 ||
    address.indexOf('고양시 일산동구') > -1 ||
    address.indexOf('고양시 일산서구') > -1 ||
    address.indexOf('성남시 분당구') > -1 ||
    address.indexOf('성남시 수정구') > -1 ||
    address.indexOf('성남시 중원구') > -1 ||
    address.indexOf('수원시 권선구') > -1 ||
    address.indexOf('수원시 영통구') > -1 ||
    address.indexOf('수원시 장안구') > -1 ||
    address.indexOf('수원시 팔달구') > -1 ||
    address.indexOf('안산시 단원구') > -1 ||
    address.indexOf('안산시 상록구') > -1 ||
    address.indexOf('안양시 동안구') > -1 ||
    address.indexOf('안양시 만안구') > -1 ||
    address.indexOf('용인시 기흥구') > -1 ||
    address.indexOf('용인시 수지구') > -1 ||
    address.indexOf('용인시 처인구') > -1 ||
    address.indexOf('청주시 상당구') > -1 ||
    address.indexOf('청주시 서원구') > -1 ||
    address.indexOf('청주시 청원구') > -1 ||
    address.indexOf('청주시 흥덕구') > -1 ||
    address.indexOf('천안시 동남구') > -1 ||
    address.indexOf('천안시 서북구') > -1 ||
    address.indexOf('전주시 덕진구') > -1 ||
    address.indexOf('전주시 완산구') > -1 ||
    address.indexOf('포항시 남구') > -1 ||
    address.indexOf('포항시 북구') > -1 ||
    address.indexOf('창원시 마산합포구') > -1 ||
    address.indexOf('창원시 마산회원구') > -1 ||
    address.indexOf('창원시 성산구') > -1 ||
    address.indexOf('창원시 의창구') > -1 ||
    address.indexOf('창원시 진해구') > -1
  ) {
    return {
      region1: address_words[0],
      region2: address_words[1] + " " + address_words[2],
      region3: address_words[3],
      region4: address_words[4],
      region5: address_words[address_words.length -1],
    }
  }

  return {
    region1: address_words[0],
    region2: address_words[1],
    region3: address_words[2],
    region4: address_words[3],
    region5: address_words[address_words.length -1],
  }
};

/**
 * 크롤러를 통해 얻은 Winning 데이터를 가공하여 DB에 삽입.
 * @param winning
 * @returns {Promise<null>}
 */
const insertWinning = async (winning) => {
  // store DB에 해당 판매점
  const { rank, round, selection, storeName, address } = winning;
  let { region1, region2, region3, region4, region5 } = await devideRegion(address.replace(/ +/g, " ").trim());
  if (!region4) region4 = '값없음';

  // winning 데이터를 DB로 insert.
  const makeWinning = async (rank, selection, round) => {
    const winning = await db.Winning.create({
      rank,
      selection,
      round,
    });
    return winning;
  };


  let stores = null;

  if (!region2) { // 가끔 주소가 한단어일때 에러 예외처리
    await makeWinning(rank, selection, round);
    return null;
  } else if (region1 === '세종') { // 세종시일때는 region1과 storeName만 비교
    stores = await db.Store.findAll({
      where: {
        name: storeName,
        region1,
      }
    });
  } else {
    stores = await db.Store.findAll({
      where: {
        name: storeName,
        region1,
        region2,
      }
    });
  }

  if (stores.length === 0) {
    await makeWinning(rank, selection, round);
    console.log('입력 성공 : 판매점 존재 X');
    return null;
  }

  if (stores.length === 1) {
    const newWinning = await makeWinning(rank, selection, round);
    await stores[0].addWinning(newWinning.id);
    console.log('입력 성공 : 판매점 존재 O (name)');
    return null;
  }

  // region3를 비교후 0,1개일때 값입력, 2개이상일때 region5 비교
  const region3Stores = stores.filter((store) => store.region3 === region3 || store.region3_new === region3);

  if (region3Stores.length === 0) {
    await makeWinning(rank, selection, round);
    console.log('입력 성공 : 판매점 존재 X (region3)');
    return null;
  }

  if (region3Stores.length === 1) {
    const newWinning = await makeWinning(rank, selection, round);
    await region3Stores[0].addWinning(newWinning.id);
    console.log('입력 성공 : 판매점 존재 O (region3)');
    return null;
  }

  // region3를 비교후 0,1개일때 값입력, 2개이상일때 region5 비교
  const region4Stores = stores.filter((store) => store.region4 === region4 || store.region4_new === region4);

  if (region4Stores.length === 0) {
    await makeWinning(rank, selection, round);
    console.log('입력 성공 : 판매점 존재 X (region4)');
    return null;
  }

  if (region4Stores.length === 1) {
    const newWinning = await makeWinning(rank, selection, round);
    await region4Stores[0].addWinning(newWinning.id);
    console.log('입력 성공 : 판매점 존재 O (region4)');
    return null;
  }

  // region5를 비교후 0,1개일때 값입력, 2개 이상일때 => 크롤러 멈춤
  const region5Stores = region3Stores.filter((store) => store.region5 === region5 || store.region5_new === region5);

  if (region5Stores.length === 0) {
    await makeWinning(rank, selection, round);
    console.log('입력 성공 : 판매점 존재 X (region5)');
    return null;
  }

  if (region5Stores.length === 1) {
    const newWinning = await makeWinning(rank, selection, round);
    await region5Stores[0].addWinning(newWinning.id);
    console.log('입력 성공 : 판매점 존재 O (region5)');
    return null;
  }

  if (region5Stores.length >= 2) {
    for (const store of region5Stores) {
      await makeWinning(rank, selection + "에러", round);
      console.log('입력 성공 : 판매점 존재 X (에러 + region5)');
    }
    return null;
  }
};

/** DEV Cron 테스트가 아니고, DEV환경일때만 파일에서 바로 크론작업 수행 **/
if (IS_CRON_TEST) {
  console.log('CRON 테스트')
} else if (IS_DEV) {
  insertStoreWinning(false);
}

module.exports.crawl = insertStoreWinning;
