const { App, AwsLambdaReceiver } = require('/opt/node_modules/@slack/bolt');
// require('/opt/node_modules/moment-timezone');
// const moment = require("/opt/node_modules/moment");
const AWS = require('/opt/node_modules/aws-sdk');

const awsLambdaReceiver = new AwsLambdaReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

const dynamoDB = new AWS.DynamoDB.DocumentClient();

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver: awsLambdaReceiver,

  // When using the AwsLambdaReceiver, processBeforeResponse can be omitted.
  // If you use other Receivers, such as ExpressReceiver for OAuth flow support
  // then processBeforeResponse: true is required. This option will defer sending back
  // the acknowledgement until after your handler has run to ensure your handler
  // isn't terminated early by responding to the HTTP request that triggered it.

  // processBeforeResponse: true

});

exports.lambdaHandler = async (event, context, callback) => {
  const d = new Date();
  const url = "https://leetcode.com/problems/"

  const client = app.client
  const problem = await getProblem()
  const level = [0, "쉬움", "보통", "어려움"]
  let result;

  const lastMessage = await getLastMessage()

  if (lastMessage.ts) {
    let userList = lastMessage["users"]

    userList = await getAcUserList(userList, lastMessage["slug"])
    
    const acUserList = userList[0]
    const anotherUserList = userList[1]

    const text = "- 문제 푼사람 \n" + acUserList.join("\n") + "\n\n\n" + "- 나머지 \n" + anotherUserList.join("\n")
    
    console.log(text)

    result = await client.chat.postMessage({
      channel: process.env.channelId,
      thread_ts: lastMessage["ts"],
      text: text
    });
  }

  result = await client.chat.postMessage({
    channel: process.env.channelId,
    text: `[오늘의 문제] <${url + problem["slug"]} | ${problem["name"]}> 난이도 ${level[problem["level"]]}`
  })

  await saveLastMessage(result.ts, problem["slug"])

  return { text: 'OK' }
}

// userList [{ slack_id, leetcode_id }]
async function getAcUserList(userList, slug) {
  let acUserList = []
  let anotherUserList = []
  const url = "https://leetcode.com/graphql/"
  

  // user { slack_id, leetcode_id }
  await Promise.all(userList.map(async user => {
    
    let graphql = JSON.stringify({
      query: "query recentAcSubmissions($username: String!, $limit: Int!) {\n  recentAcSubmissionList(username: $username, limit: $limit) {\n    id\n    title\n    titleSlug\n    timestamp\n  }\n}",
      variables: {"username": user["leetcode_id"], "limit":15}
    })

    let requestOptions = {
      method: 'POST',
      body: graphql,
      headers: {
        "Content-Type": "application/json"
      }
    };

    let data = await fetch(url, requestOptions).then(response => response.json())
    
    console.log(`data: ${JSON.stringify(data)}`)

    let submission = data["data"]["recentAcSubmissionList"].find(ac => ac["titleSlug"] == slug)
    
    console.log(`submission: ${submission}`)

    if (submission) {
      console.log(`slack_id: ${user["slack_id"]}`)
      acUserList.push(user["slack_id"])
    } else {
      anotherUserList.push(user["slack_id"])
    }

  }));

  return [acUserList, anotherUserList]
}

// attributes
// type: String
// problems: array

async function getProblem() {
  const params = {
    Limit: 50,
    ReturnConsumedCapacity: "TOTAL",
    Select: "ALL_ATTRIBUTES",
    TableName: "LeetCode-for-Slack",
    FilterExpression: "#a = :v",
    ExpressionAttributeNames: {
      "#a": "type"
    },
    ExpressionAttributeValues: {
      ":v": "problems"
    }
  };

  const data = await dynamoDB.scan(params).promise()
  const problem = data['Items'][0]
  const leetCodeProblems = await getLeetCodeProblems()

  if (problem["problems"].length < 5) {
    problem["problems"].push(...leetCodeProblems)
  }

  const returnProblems = problem.problems.shift();
  await saveProblem(problem);

  return returnProblems
}

async function saveProblem(problem) {
  const params = {
    TableName: "LeetCode-for-Slack",
    Key: {
      "type": "problems"
    },
    UpdateExpression: "SET #c = :vals",
    ExpressionAttributeNames: {
      "#c": "problems"
    },
    ExpressionAttributeValues: {
      ":vals": problem.problems
    },
    ReturnValues: "UPDATED_NEW"
  }

  const result = await dynamoDB.update(params).promise()
}

// attributes
// type: String
// ts: String
// slug: String
// users: array [{ slack_id, leetcode_id }]

async function getLastMessage() {
  const params = {
    Limit: 50,
    ReturnConsumedCapacity: "TOTAL",
    Select: "ALL_ATTRIBUTES",
    TableName: "LeetCode-for-Slack",
    FilterExpression: "#a = :v",
    ExpressionAttributeNames: {
      "#a": "type"
    },
    ExpressionAttributeValues: {
      ":v": "lastMessage"
    }
  };

  const data = await dynamoDB.scan(params).promise()
  return data['Items'][0]
}

async function saveLastMessage(ts, slug) {
  const params = {
    TableName: "LeetCode-for-Slack",
    Key: {
      "type": "lastMessage"
    },
    UpdateExpression: "SET #a = :x, #b = :y",
    ExpressionAttributeNames: {
      "#a": "slug",
      "#b": "ts"
    },
    ExpressionAttributeValues: {
      ":x": slug,
      ":y": ts
    },
    ReturnValues: "UPDATED_NEW"
  }

  const result = await dynamoDB.update(params).promise()
}

async function getLeetCodeProblems() {
  let problemList = [];
  const url = "https://leetcode.com/api/problems/all/"
  const requestOptions = {
    method: 'GET'
  };

  let data = await fetch(url, requestOptions).then(response => response.json())
  

  const total = data["stat_status_pairs"].length
  while (problemList.length < 5) {
    let problem = data["stat_status_pairs"][getRandomInt(0, total)]
    
    if (!problem["paid_only"]) { 

      problemList.push({
        slug: problem["stat"]["question__title_slug"],
        name: problem["stat"]["question__title"],
        question_id: problem["stat"]["question_id"],
        frontend_question_id: problem["stat"]["frontend_question_id"],
        level: problem["difficulty"]["level"],
      })
    }
  }

  return problemList
}


function getRandomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min)) + min; //최댓값은 제외, 최솟값은 포함
}