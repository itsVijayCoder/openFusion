package cloud

type Client struct {
	BaseURL string
	Token   string
}

func NewClient(baseURL string, token string) Client {
	return Client{BaseURL: baseURL, Token: token}
}
