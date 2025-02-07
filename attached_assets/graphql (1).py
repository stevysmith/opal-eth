import requests
from flask import Flask, request, jsonify

app = Flask(__name__)

# Define the GraphQL API URL
graphql_url = "https://gateway-arbitrum.network.thegraph.com/api/7ad5dec0c95579e6812957254486d013/subgraphs/id/HUZDsRpEVP2AvzDCyzDHtdc64dyDxx8FQjzsmqSg4H3B"

@app.route('/graphql-query', methods=['POST'])
def graphql_query():
    try:
        # Get the GraphQL query from the request
        query = request.json.get('query')

        # Make a POST request to the GraphQL API
        response = requests.post(graphql_url, json={'query': query}, timeout=60)

        # Check the response status code
        if response.status_code == 200:
            data = response.json()
            return jsonify(data)
        else:
            return jsonify({'error': 'GraphQL query failed'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True)
